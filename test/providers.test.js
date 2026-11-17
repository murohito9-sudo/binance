const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createProviderRegistry } = require("../lib/providers");
const { readChatStream } = require("../lib/providers/sse");

function sseBody(chunks) {
  return chunks
    .map((chunk) =>
      typeof chunk === "string"
        ? `data: ${chunk}\n\n`
        : `data: ${JSON.stringify(chunk)}\n\n`,
    )
    .join("");
}

function delta(text) {
  return { choices: [{ delta: { content: text } }] };
}

async function startStub(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function configWith(providers) {
  return {
    ai: {
      timeoutMs: 5000,
      providerOrder: providers.map((p) => p.id),
      providers,
    },
  };
}

test("mengalirkan delta dari provider dan melaporkan provider aktif", async () => {
  const stub = await startStub((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseBody([delta("Halo"), delta(" dunia"), "[DONE]"]));
    res.end();
  });
  try {
    const registry = createProviderRegistry(
      configWith([
        { id: "primary", label: "Primary", baseUrl: stub.baseUrl, apiKey: "k" },
      ]),
    );
    const seen = [];
    const result = await registry.streamChat({
      messages: [{ role: "user", content: "hai" }],
      onDelta: (text) => seen.push(text),
    });
    assert.deepEqual(seen, ["Halo", " dunia"]);
    assert.equal(result.provider, "primary");
    assert.equal(result.text, "Halo dunia");
    assert.equal(registry.available().length, 1);
  } finally {
    await stub.close();
  }
});

test("beralih ke provider kedua bila provider pertama gagal sebelum ada teks", async () => {
  const failing = await startStub((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "provider down" } }));
  });
  const healthy = await startStub((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseBody([delta("dari cadangan"), "[DONE]"]));
    res.end();
  });
  try {
    const registry = createProviderRegistry(
      configWith([
        { id: "primary", label: "Primary", baseUrl: failing.baseUrl, apiKey: "k" },
        { id: "backup", label: "Backup", baseUrl: healthy.baseUrl, apiKey: "k" },
      ]),
    );
    const seen = [];
    const result = await registry.streamChat({
      messages: [{ role: "user", content: "hai" }],
      onDelta: (text) => seen.push(text),
    });
    assert.equal(result.provider, "backup");
    assert.deepEqual(seen, ["dari cadangan"]);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].ok, false);
    assert.equal(result.attempts[1].ok, true);
  } finally {
    await failing.close();
    await healthy.close();
  }
});

test("tidak mengulang jawaban pada provider lain setelah teks terkirim", async () => {
  const partial = await startStub((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseBody([delta("setengah")]));
    res.end();
  });
  const backup = await startStub((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseBody([delta("duplikat"), "[DONE]"]));
    res.end();
  });
  try {
    const registry = createProviderRegistry(
      configWith([
        { id: "primary", label: "Primary", baseUrl: partial.baseUrl, apiKey: "k" },
        { id: "backup", label: "Backup", baseUrl: backup.baseUrl, apiKey: "k" },
      ]),
    );
    const seen = [];
    await assert.rejects(
      () =>
        registry.streamChat({
          messages: [],
          onDelta: (text) => seen.push(text),
        }),
      /terputus sebelum selesai/,
    );
    assert.deepEqual(seen, ["setengah"]);
  } finally {
    await partial.close();
    await backup.close();
  }
});

test("health melakukan pemeriksaan nyata, bukan menebak dari API key", async () => {
  const reachable = await startStub((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    res.writeHead(404);
    res.end();
  });
  const unauthorized = await startStub((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "nope" }));
  });
  try {
    const registry = createProviderRegistry(
      configWith([
        { id: "ok", label: "OK", baseUrl: reachable.baseUrl, apiKey: "k" },
        { id: "denied", label: "Denied", baseUrl: unauthorized.baseUrl, apiKey: "k" },
        { id: "unset", label: "Unset", baseUrl: "", apiKey: "" },
      ]),
    );
    const results = await registry.probe();
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.ok.ok, true);
    assert.equal(byId.denied.ok, false);
    assert.equal(byId.denied.reason, "unauthorized");
    assert.equal(registry.describe().find((p) => p.id === "unset").configured, false);
  } finally {
    await reachable.close();
    await unauthorized.close();
  }
});

test("readChatStream menolak aliran tanpa penanda selesai", async () => {
  const body = new Response(sseBody([delta("tanpa akhir")])).body;
  await assert.rejects(() => readChatStream(body, () => {}), /terputus/);
});

test("readChatStream meneruskan galat dari chunk error", async () => {
  const body = new Response(
    sseBody([{ error: { message: "kuota habis" } }]),
  ).body;
  await assert.rejects(() => readChatStream(body, () => {}), /kuota habis/);
});
