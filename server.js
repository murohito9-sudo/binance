const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const mysql = require("mysql2/promise");
const ownerAuth = require("./lib/auth");
const binance = require("./lib/binance");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["balanced", "concise", "creative"]);
const FILE_TYPES = {
  "application/pdf": {
    ext: "pdf",
    signature: (bytes) => bytes.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  "image/png": {
    ext: "png",
    signature: (bytes) =>
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    ext: "jpg",
    signature: (bytes) =>
      bytes.length > 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
  },
  "image/webp": {
    ext: "webp",
    signature: (bytes) =>
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP",
  },
};
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const SYSTEM_PROMPTS = {
  balanced:
    "Kamu adalah Nalar, asisten AI yang jernih, hangat, dan membantu dalam bahasa Indonesia. Jawab sesuai bahasa pengguna. Berikan jawaban akurat dan terstruktur, nyatakan ketidakpastian saat perlu, dan gunakan Markdown yang mudah dibaca. Jangan mengaku telah melakukan tindakan di luar percakapan.",
  concise:
    "Kamu adalah Nalar, asisten AI yang ringkas dan jelas. Jawab dalam bahasa Indonesia kecuali pengguna memakai bahasa lain. Mulai dari jawaban inti, lalu hanya tambahkan detail yang diperlukan. Gunakan Markdown sederhana dan jangan mengorbankan ketepatan.",
  creative:
    "Kamu adalah Nalar, rekan berpikir yang kreatif, terbuka, dan tetap jernih. Jawab dalam bahasa Indonesia kecuali pengguna memakai bahasa lain. Tawarkan sudut pandang segar dengan struktur Markdown yang mudah dipahami, tetapi bedakan fakta dari ide atau dugaan.",
};

let pool;
let shuttingDown = false;

function sendJson(res, status, value) {
  if (res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(
          Object.assign(new Error("Ukuran permintaan terlalu besar."), {
            status: 413,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

async function readJson(req, maxBytes = 1024 * 1024) {
  const raw = await readBody(req, maxBytes);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Format permintaan tidak valid."), {
      status: 400,
    });
  }
}

function validateMode(mode) {
  return MODES.has(mode) ? mode : "balanced";
}

function titleFromPrompt(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Percakapan baru";
  return clean.length > 66 ? `${clean.slice(0, 63).trimEnd()}…` : clean;
}

function parseAttachments(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const decoded = JSON.parse(value);
    return Array.isArray(decoded) ? decoded : [];
  } catch {
    return [];
  }
}

async function initDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL belum tersedia pada runtime.");
  pool = mysql.createPool(process.env.DATABASE_URL);
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner_id CHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL DEFAULT 'Percakapan baru',
    mode VARCHAR(24) NOT NULL DEFAULT 'balanced',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX conversations_owner_updated (owner_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
    id CHAR(36) NOT NULL PRIMARY KEY,
    conversation_id CHAR(36) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content LONGTEXT NOT NULL,
    attachments JSON NULL,
    feedback TINYINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX messages_conversation_seq (conversation_id, seq),
    CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id)
      REFERENCES conversations (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS owner_identity (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    subject_hash BINARY(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function findConversation(id, ownerId) {
  const [rows] = await pool.execute(
    "SELECT id, owner_id, title, mode FROM conversations WHERE id = ? AND owner_id = ? LIMIT 1",
    [id, ownerId],
  );
  return rows[0] || null;
}

async function createConversation(ownerId, title, mode) {
  const id = crypto.randomUUID();
  await pool.execute(
    "INSERT INTO conversations (id, owner_id, title, mode) VALUES (?, ?, ?, ?)",
    [id, ownerId, titleFromPrompt(title), validateMode(mode)],
  );
  const [rows] = await pool.execute(
    "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE id = ?",
    [id],
  );
  return rows[0];
}

function serviceHeaders(extra = {}) {
  return {
    ...(process.env.MANUS_API_KEY
      ? { Authorization: `Bearer ${process.env.MANUS_API_KEY}` }
      : {}),
    ...extra,
  };
}

async function storageCall(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: serviceHeaders(init?.headers || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error)
    throw new Error(
      data.error?.message ||
        data.error ||
        `Layanan berkas gagal (${response.status}).`,
    );
  return data;
}

function storageBase() {
  const base = process.env.MANUS_API_URL;
  if (!base) throw new Error("Layanan penyimpanan belum terhubung.");
  return base.replace(/\/+$/, "");
}

async function signedDownload(key) {
  const url = new URL(`${storageBase()}/v1/storage/presign/get`);
  url.searchParams.set("path", key);
  const data = await storageCall(url, { method: "GET" });
  if (!data.url) throw new Error("Tautan unduhan lampiran tidak tersedia.");
  return data.url;
}

async function contentParts(prompt, attachments) {
  const parts = [];
  if (prompt) parts.push({ type: "text", text: prompt });
  for (const file of attachments) {
    const downloadUrl = await signedDownload(file.key);
    if (file.mimeType.startsWith("image/")) {
      parts.push({
        type: "image_url",
        image_url: { url: downloadUrl, detail: "auto" },
      });
    } else if (file.mimeType === "application/pdf") {
      parts.push({
        type: "file_url",
        file_url: { url: downloadUrl, mime_type: "application/pdf" },
      });
    }
  }
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}

function writeSse(res, event) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function listConversations(url, res, ownerId) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 160);
  let rows;
  if (q) {
    const term = `%${q}%`;
    [rows] = await pool.execute(
      `SELECT c.id, c.title, c.mode, c.created_at, c.updated_at
      FROM conversations c
      WHERE c.owner_id = ? AND (c.title LIKE ? OR EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?
      )) ORDER BY c.updated_at DESC LIMIT 100`,
      [ownerId, term, term],
    );
  } else {
    [rows] = await pool.execute(
      "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100",
      [ownerId],
    );
  }
  sendJson(res, 200, { conversations: rows });
}

async function getMessages(url, res, id, ownerId) {
  const convo = await findConversation(id, ownerId);
  if (!convo)
    return sendJson(res, 404, { error: "Percakapan tidak ditemukan." });
  const [rows] = await pool.execute(
    "SELECT id, role, content, attachments, feedback, created_at FROM messages WHERE conversation_id = ? ORDER BY seq ASC LIMIT 200",
    [id],
  );
  sendJson(res, 200, {
    messages: rows.map((row) => ({
      ...row,
      attachments: parseAttachments(row.attachments),
    })),
  });
}

async function createConversationRoute(req, res, ownerId) {
  const body = await readJson(req);
  const conversation = await createConversation(
    ownerId,
    body.title || "Percakapan baru",
    body.mode,
  );
  sendJson(res, 201, { conversation });
}

async function updateConversation(req, res, id, ownerId) {
  const body = await readJson(req);
  const conversation = await findConversation(id, ownerId);
  if (!conversation)
    return sendJson(res, 404, { error: "Percakapan tidak ditemukan." });
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 120);
    if (!title)
      return sendJson(res, 400, {
        error: "Nama percakapan tidak boleh kosong.",
      });
    await pool.execute(
      "UPDATE conversations SET title = ? WHERE id = ? AND owner_id = ?",
      [title, id, ownerId],
    );
  }
  if (typeof body.mode === "string" && MODES.has(body.mode)) {
    await pool.execute(
      "UPDATE conversations SET mode = ? WHERE id = ? AND owner_id = ?",
      [body.mode, id, ownerId],
    );
  }
  const [rows] = await pool.execute(
    "SELECT id, title, mode, updated_at FROM conversations WHERE id = ?",
    [id],
  );
  sendJson(res, 200, { conversation: rows[0] });
}

async function deleteConversation(req, res, id, ownerId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id FROM conversations WHERE id = ? AND owner_id = ? FOR UPDATE",
      [id, ownerId],
    );
    if (!rows.length) {
      await connection.rollback();
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan." });
    }
    await connection.execute("DELETE FROM messages WHERE conversation_id = ?", [
      id,
    ]);
    await connection.execute(
      "DELETE FROM conversations WHERE id = ? AND owner_id = ?",
      [id, ownerId],
    );
    await connection.commit();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function uploadAttachment(req, res, url, ownerId) {
  const conversationId = url.searchParams.get("conversationId");
  if (!UUID_RE.test(String(conversationId || "")))
    return sendJson(res, 400, { error: "Percakapan tidak valid." });
  if (!(await findConversation(conversationId, ownerId)))
    return sendJson(res, 404, { error: "Percakapan tidak ditemukan." });
  const mimeType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const type = FILE_TYPES[mimeType];
  if (!type)
    return sendJson(res, 415, {
      error: "Format berkas tidak didukung. Unggah PDF, PNG, JPEG, atau WebP.",
    });
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > 10 * 1024 * 1024)
    return sendJson(res, 413, { error: "Ukuran berkas maksimal 10 MB." });
  const bytes = await readBody(req, 10 * 1024 * 1024);
  if (!bytes.length) return sendJson(res, 400, { error: "Berkas kosong." });
  if (!type.signature(bytes))
    return sendJson(res, 415, {
      error: "Isi berkas tidak cocok dengan format yang dipilih.",
    });
  const originalName = String(url.searchParams.get("name") || "Lampiran")
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .slice(0, 140);
  const key = `nalarai/${ownerId}/${conversationId}/${crypto.randomBytes(16).toString("hex")}.${type.ext}`;
  const presignUrl = new URL(`${storageBase()}/v1/storage/presign/put`);
  presignUrl.searchParams.set("path", key);
  const signed = await storageCall(presignUrl, { method: "GET" });
  if (!signed.url)
    throw new Error("Layanan penyimpanan belum mengembalikan alamat unggah.");
  const transfer = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  if (!transfer.ok)
    throw new Error(`Berkas gagal disimpan (${transfer.status}).`);
  sendJson(res, 201, {
    id: crypto.randomUUID(),
    key,
    stableUrl: `/manus-storage/${key}`,
    name: originalName,
    mimeType,
    size: bytes.length,
  });
}

async function validateChatAttachments(input, ownerId, conversationId) {
  if (!Array.isArray(input) || input.length > 4)
    throw Object.assign(new Error("Maksimal 4 lampiran per pesan."), {
      status: 400,
    });
  const safe = [];
  for (const item of input) {
    if (
      !item ||
      typeof item.key !== "string" ||
      !item.key.startsWith(`nalarai/${ownerId}/${conversationId}/`)
    ) {
      throw Object.assign(
        new Error("Lampiran tidak cocok dengan percakapan ini."),
        { status: 400 },
      );
    }
    if (!FILE_TYPES[item.mimeType])
      throw Object.assign(new Error("Format lampiran tidak didukung."), {
        status: 415,
      });
    safe.push({
      id: String(item.id || crypto.randomUUID()),
      key: item.key,
      name: String(item.name || "Lampiran").slice(0, 140),
      mimeType: item.mimeType,
      size: Number(item.size || 0),
      stableUrl: `/manus-storage/${item.key}`,
    });
  }
  return safe;
}

async function writeModelStream(req, res, ownerId) {
  const body = await readJson(req, 2 * 1024 * 1024);
  const apiBase = process.env.MANUS_API_URL;
  if (!apiBase || !process.env.MANUS_API_KEY)
    return sendJson(res, 503, {
      error: "Layanan AI belum terhubung pada runtime ini.",
    });
  const mode = validateMode(body.mode);
  let conversationId = body.conversationId;
  let conversation;
  const retryFor = body.regenerateFor || null;
  if (retryFor && !UUID_RE.test(String(retryFor)))
    return sendJson(res, 400, { error: "Pesan yang diminta tidak valid." });
  if (conversationId) {
    if (!UUID_RE.test(String(conversationId)))
      return sendJson(res, 400, { error: "Percakapan tidak valid." });
    conversation = await findConversation(conversationId, ownerId);
    if (!conversation)
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan." });
  } else {
    if (retryFor)
      return sendJson(res, 400, {
        error: "Tidak dapat mengulang percakapan yang tidak ditemukan.",
      });
    conversation = await createConversation(ownerId, body.prompt, mode);
    conversationId = conversation.id;
  }

  let userMessageId = retryFor;
  let prompt = String(body.prompt || "")
    .slice(0, 20000)
    .trim();
  let attachments;
  const priorAnswerIds = [];
  if (retryFor) {
    const [users] = await pool.execute(
      "SELECT id, seq, content, attachments FROM messages WHERE id = ? AND conversation_id = ? AND role = ? LIMIT 1",
      [retryFor, conversationId, "user"],
    );
    const target = users[0];
    if (!target)
      return sendJson(res, 404, {
        error: "Pesan untuk diulang tidak ditemukan.",
      });
    const [latest] = await pool.execute(
      "SELECT id FROM messages WHERE conversation_id = ? AND role = ? ORDER BY seq DESC LIMIT 1",
      [conversationId, "user"],
    );
    if (!latest[0] || latest[0].id !== retryFor)
      return sendJson(res, 409, {
        error: "Hanya pesan terakhir yang dapat dibuat ulang.",
      });
    prompt = target.content;
    attachments = parseAttachments(target.attachments);
    const [previous] = await pool.execute(
      "SELECT id FROM messages WHERE conversation_id = ? AND role = ? AND seq > ?",
      [conversationId, "assistant", target.seq],
    );
    priorAnswerIds.push(...previous.map((row) => row.id));
  } else {
    attachments = await validateChatAttachments(
      body.attachments,
      ownerId,
      conversationId,
    );
    if (!prompt && !attachments.length)
      return sendJson(res, 400, {
        error: "Tulis pesan atau lampirkan berkas terlebih dahulu.",
      });
    if (!prompt && attachments.length)
      prompt = "Tolong jelaskan isi berkas yang saya lampirkan.";
    const [count] = await pool.execute(
      "SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?",
      [conversationId],
    );
    if (Number(count[0].total) === 0) {
      const generatedTitle = titleFromPrompt(prompt);
      await pool.execute(
        "UPDATE conversations SET title = ? WHERE id = ? AND owner_id = ?",
        [generatedTitle, conversationId, ownerId],
      );
      conversation.title = generatedTitle;
    }
    userMessageId = crypto.randomUUID();
    await pool.execute(
      "INSERT INTO messages (id, conversation_id, role, content, attachments) VALUES (?, ?, ?, ?, ?)",
      [
        userMessageId,
        conversationId,
        "user",
        prompt,
        attachments.length ? JSON.stringify(attachments) : null,
      ],
    );
  }
  await pool.execute(
    "UPDATE conversations SET mode = ? WHERE id = ? AND owner_id = ?",
    [mode, conversationId, ownerId],
  );
  const [historyRows] = await pool.execute(
    "SELECT id, role, content, attachments FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT 40",
    [conversationId],
  );
  const history = historyRows.reverse();
  const messages = [{ role: "system", content: SYSTEM_PROMPTS[mode] }];
  for (const message of history) {
    if (message.role === "user" && message.id === userMessageId) {
      messages.push({
        role: "user",
        content: await contentParts(prompt, attachments),
      });
    } else if (message.role === "user") {
      const files = parseAttachments(message.attachments);
      messages.push({
        role: "user",
        content: files.length
          ? await contentParts(message.content, files)
          : message.content,
      });
    } else if (message.role === "assistant") {
      messages.push({ role: "assistant", content: message.content });
    }
  }

  const controller = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) controller.abort();
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.flushHeaders?.();
  writeSse(res, {
    type: "meta",
    conversationId,
    userMessageId,
    title: conversation.title,
    prompt,
    attachments: attachments.map(({ id, name, mimeType, size }) => ({
      id,
      name,
      mimeType,
      size,
    })),
  });
  let assistantText = "";
  try {
    const upstream = await fetch(
      `${apiBase.replace(/\/+$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: serviceHeaders({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify({ messages, stream: true }),
      },
    );
    if (!upstream.ok) {
      const detail = await upstream.text();
      let friendly = `Layanan AI merespons dengan status ${upstream.status}.`;
      try {
        const parsed = JSON.parse(detail);
        friendly = parsed.error?.message || parsed.error || friendly;
      } catch {
        if (detail) friendly = detail.slice(0, 420);
      }
      throw new Error(friendly);
    }
    if (!upstream.body) throw new Error("Aliran jawaban AI tidak tersedia.");
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let readDone = false;
    let sawDone = false;
    const consumeBlock = (block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return false;
      if (data === "[DONE]") return true;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        return false;
      }
      if (chunk.error)
        throw new Error(
          chunk.error.message || "Layanan AI gagal memproses permintaan.",
        );
      let delta = chunk.choices?.[0]?.delta?.content;
      if (Array.isArray(delta))
        delta = delta.map((part) => part.text || "").join("");
      if (typeof delta === "string" && delta) {
        assistantText += delta;
        writeSse(res, { type: "delta", text: delta });
      }
      return false;
    };
    while (!readDone) {
      const { value, done } = await reader.read();
      if (done) {
        readDone = true;
        break;
      }
      pending += decoder.decode(value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() || "";
      for (const block of blocks) {
        if (consumeBlock(block)) {
          sawDone = true;
          readDone = true;
          break;
        }
      }
    }
    if (!sawDone) {
      pending += decoder.decode();
      if (pending.trim()) sawDone = consumeBlock(pending);
    }
    if (!sawDone)
      throw new Error(
        "Aliran jawaban terputus sebelum selesai. Coba ulangi pesanmu.",
      );
    if (controller.signal.aborted) return;
    if (!assistantText.trim())
      throw new Error(
        "Model tidak mengembalikan teks. Coba kirim ulang pesanmu.",
      );
    const assistantId = crypto.randomUUID();
    await pool.execute(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
      [assistantId, conversationId, "assistant", assistantText],
    );
    if (priorAnswerIds.length) {
      const placeholders = priorAnswerIds.map(() => "?").join(",");
      await pool.execute(
        `DELETE FROM messages WHERE conversation_id = ? AND role = 'assistant' AND id IN (${placeholders})`,
        [conversationId, ...priorAnswerIds],
      );
    }
    await pool.execute(
      "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND owner_id = ?",
      [conversationId, ownerId],
    );
    finished = true;
    writeSse(res, { type: "done", messageId: assistantId });
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    finished = true;
    writeSse(res, {
      type: "error",
      message: error.message || "Layanan AI belum dapat menjawab.",
    });
    res.end();
  }
}

async function feedback(req, res, ownerId) {
  const body = await readJson(req);
  const messageId = String(body.messageId || "");
  const value = Number(body.value);
  if (!UUID_RE.test(messageId) || ![-1, 1].includes(value))
    return sendJson(res, 400, { error: "Umpan balik tidak valid." });
  const [rows] = await pool.execute(
    `SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND m.role = 'assistant' AND c.owner_id = ? LIMIT 1`,
    [messageId, ownerId],
  );
  if (!rows.length)
    return sendJson(res, 404, { error: "Jawaban tidak ditemukan." });
  await pool.execute("UPDATE messages SET feedback = ? WHERE id = ?", [
    value,
    messageId,
  ]);
  sendJson(res, 200, { ok: true });
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: "Alamat tidak valid." });
  }
  const requestPath = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`))
    return sendJson(res, 403, { error: "Tidak diizinkan." });
  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    return sendJson(res, 404, { error: "Halaman tidak ditemukan." });
  }
  if (!stats.isFile())
    return sendJson(res, 404, { error: "Halaman tidak ditemukan." });
  res.writeHead(200, {
    "Content-Type":
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control":
      path.basename(filePath) === "manus-routes.json" ? "no-cache" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

async function authSession(req, res) {
  try {
    const owner = await ownerAuth.findOwner(req, pool);
    return sendJson(res, 200, {
      authenticated: true,
      loginAvailable: ownerAuth.loginAvailable(),
      csrfToken: owner.claims.csrf,
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403)
      return sendJson(res, 200, {
        authenticated: false,
        loginAvailable: ownerAuth.loginAvailable(),
      });
    throw error;
  }
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health")
    return sendJson(res, 200, { ok: true });
  if (req.method === "GET" && pathname === "/api/auth/session")
    return authSession(req, res);
  if (req.method === "POST" && pathname === "/api/auth/start") {
    const body = await readJson(req, 8192);
    const start = ownerAuth.createOAuthStart(body.origin, req.headers.origin);
    res.setHeader("Set-Cookie", start.cookie);
    return sendJson(res, 200, { url: start.url });
  }
  if (req.method === "POST" && pathname === "/api/auth/callback") {
    const body = await readJson(req, 16 * 1024);
    const session = await ownerAuth.completeOAuth({ body, req, pool });
    res.setHeader("Set-Cookie", [session.cookie, session.clearNonce]);
    return sendJson(res, 200, {
      authenticated: true,
      csrfToken: session.csrfToken,
    });
  }
  if (req.method === "GET" || req.method === "HEAD") {
    if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);
  }

  if (!pathname.startsWith("/api/"))
    return sendJson(res, 404, { error: "Endpoint tidak ditemukan." });

  const owner = await ownerAuth.findOwner(req, pool);
  if (req.method !== "GET" && req.method !== "HEAD")
    ownerAuth.requireCsrf(req, owner.claims);
  const ownerId = owner.ownerId;

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    res.setHeader("Set-Cookie", ownerAuth.logoutCookie(req));
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && pathname === "/api/conversations")
    return listConversations(url, res, ownerId);
  if (req.method === "POST" && pathname === "/api/conversations")
    return createConversationRoute(req, res, ownerId);
  if (req.method === "POST" && pathname === "/api/chat")
    return writeModelStream(req, res, ownerId);
  if (req.method === "POST" && pathname === "/api/uploads")
    return uploadAttachment(req, res, url, ownerId);
  if (req.method === "POST" && pathname === "/api/feedback")
    return feedback(req, res, ownerId);
  if (req.method === "GET" && pathname === "/api/binance/status")
    return sendJson(res, 200, binance.configurationStatus());
  if (req.method === "POST" && pathname === "/api/binance/sync")
    return sendJson(res, 200, await binance.syncAccount());
  if (req.method === "POST" && pathname === "/api/binance/analyze")
    return sendJson(
      res,
      200,
      await binance.analyzeStopLoss(await readJson(req, 8192)),
    );

  const messagesMatch = pathname.match(
    /^\/api\/conversations\/([0-9a-f-]{36})\/messages$/i,
  );
  if (req.method === "GET" && messagesMatch)
    return getMessages(url, res, messagesMatch[1], ownerId);
  const conversationMatch = pathname.match(
    /^\/api\/conversations\/([0-9a-f-]{36})$/i,
  );
  if (conversationMatch && req.method === "PATCH")
    return updateConversation(req, res, conversationMatch[1], ownerId);
  if (conversationMatch && req.method === "DELETE")
    return deleteConversation(req, res, conversationMatch[1], ownerId);
  return sendJson(res, 404, { error: "Endpoint tidak ditemukan." });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        writeSse(res, {
          type: "error",
          message: error.message || "Terjadi kesalahan pada server.",
        });
        res.end();
      }
      return;
    }
    const status = Number(error.status) || 500;
    if (status >= 500) console.error("[nalar] request failed", status);
    sendJson(res, status, {
      error:
        status === 500
          ? "Terjadi gangguan saat memproses permintaan. Coba lagi."
          : error.message,
    });
  }
});

server.headersTimeout = 30000;
server.requestTimeout = 120000;

initDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () =>
      console.log(`Nalar AI listening on port ${PORT}`),
    );
  })
  .catch((error) => {
    console.error("[nalar] Database initialization failed");
    process.exitCode = 1;
  });

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    try {
      await pool?.end();
    } catch {
      /* closing */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
