const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger, sanitize } = require("../lib/logger");

function capture() {
  const lines = [];
  return {
    lines,
    sink: {
      log: (line) => lines.push(JSON.parse(line)),
      warn: (line) => lines.push(JSON.parse(line)),
      error: (line) => lines.push(JSON.parse(line)),
    },
  };
}

test("menyamarkan nilai sensitif sebelum ditulis ke log", () => {
  const clean = sanitize({
    apiKey: "rahasia",
    authorization: "Bearer xyz",
    nested: { private_key: "PEM", safe: "boleh" },
    list: [{ cookie: "session=1" }],
  });
  assert.equal(clean.apiKey, "[redacted]");
  assert.equal(clean.authorization, "[redacted]");
  assert.equal(clean.nested.private_key, "[redacted]");
  assert.equal(clean.nested.safe, "boleh");
  assert.equal(clean.list[0].cookie, "[redacted]");
});

test("menulis satu baris JSON dengan level dan event", () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: "info", sink });
  logger.info("http.request", { path: "/api/chat", token: "abc" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].event, "http.request");
  assert.equal(lines[0].path, "/api/chat");
  assert.equal(lines[0].token, "[redacted]");
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("menghormati level minimum dan logger child", () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: "warn", sink });
  logger.debug("abaikan");
  logger.info("abaikan-juga");
  logger.warn("simpan", { a: 1 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, "simpan");
  const child = logger.child({ requestId: "r1" });
  child.error("gagal", { status: 500 });
  assert.equal(lines[1].requestId, "r1");
  assert.equal(lines[1].status, 500);
});
