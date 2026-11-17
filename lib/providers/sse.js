"use strict";

/**
 * Reads an OpenAI-style `text/event-stream` chat completion body and forwards
 * each text delta. Throws when the stream ends before a `[DONE]` marker or a
 * terminal error chunk, so callers never store a truncated answer as complete.
 */
async function readChatStream(body, onDelta) {
  if (!body || typeof body.getReader !== "function")
    throw new Error("Aliran jawaban AI tidak tersedia.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let sawDone = false;
  let text = "";

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
      text += delta;
      onDelta(delta);
    }
    return false;
  };

  let done = false;
  while (!done) {
    const step = await reader.read();
    if (step.done) break;
    pending += decoder.decode(step.value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() || "";
    for (const block of blocks) {
      if (consumeBlock(block)) {
        sawDone = true;
        done = true;
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
  return text;
}

module.exports = { readChatStream };
