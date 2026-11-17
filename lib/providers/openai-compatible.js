"use strict";

const { readChatStream } = require("./sse");

function trimBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

/**
 * Adapter for any provider that speaks the OpenAI chat-completions shape
 * (`POST {base}/v1/chat/completions` with `stream: true`).
 *
 * Every capability is reported from what the configuration actually allows:
 * `configured` only means "base URL and key are present", while `health()`
 * performs a real HTTP request and is the only source of "reachable".
 */
function createOpenAICompatibleProvider(spec = {}) {
  const id = String(spec.id || "openai-compatible");
  const label = String(spec.label || id);
  const baseUrl = trimBase(spec.baseUrl);
  const apiKey = String(spec.apiKey || "");
  const configured = Boolean(baseUrl && apiKey);
  const defaultModel = spec.model || spec.defaultModel || null;

  const metrics = {
    requests: 0,
    successes: 0,
    failures: 0,
    lastLatencyMs: null,
    lastErrorAt: null,
    lastError: null,
  };
  let lastHealth = null;

  function headers(extra = {}) {
    return {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...extra,
    };
  }

  async function health({ timeoutMs = 5000 } = {}) {
    const checkedAt = new Date().toISOString();
    if (!configured) {
      lastHealth = {
        ok: false,
        reason: "not_configured",
        checkedAt,
      };
      return lastHealth;
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: "GET",
        headers: headers(),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const latencyMs = Date.now() - startedAt;
      let reason = null;
      if (!response.ok) {
        reason =
          response.status === 401 || response.status === 403
            ? "unauthorized"
            : `http_${response.status}`;
      }
      lastHealth = {
        ok: response.ok,
        status: response.status,
        reason,
        latencyMs,
        checkedAt,
      };
    } catch (error) {
      lastHealth = {
        ok: false,
        reason: "unreachable",
        detail: error?.name === "TimeoutError" ? "timeout" : "network_error",
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }
    return lastHealth;
  }

  async function stream({ messages, signal, onDelta, timeoutMs = 60000 }) {
    if (!configured)
      throw Object.assign(
        new Error("Provider AI belum dikonfigurasi pada server."),
        { status: 503, provider: id },
      );

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    metrics.requests += 1;

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: headers({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify({
          messages,
          stream: true,
          ...(defaultModel ? { model: defaultModel } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        let friendly = `Layanan AI merespons dengan status ${response.status}.`;
        try {
          const parsed = JSON.parse(detail);
          friendly = parsed.error?.message || parsed.error || friendly;
        } catch {
          if (detail) friendly = detail.slice(0, 420);
        }
        throw Object.assign(new Error(friendly), {
          status: response.status === 429 ? 429 : 502,
          provider: id,
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      const text = await readChatStream(response.body, onDelta);
      metrics.successes += 1;
      metrics.lastLatencyMs = Date.now() - startedAt;
      return { provider: id, model: defaultModel, text, latencyMs: metrics.lastLatencyMs };
    } catch (error) {
      metrics.failures += 1;
      metrics.lastErrorAt = new Date().toISOString();
      metrics.lastError = String(error?.message || "unknown").slice(0, 200);
      if (signal?.aborted)
        throw Object.assign(new Error("Permintaan dihentikan."), {
          status: 499,
          provider: id,
          aborted: true,
        });
      if (error?.name === "AbortError")
        throw Object.assign(
          new Error("Layanan AI melewati batas waktu. Coba lagi."),
          { status: 504, provider: id, retryable: true },
        );
      error.provider = error.provider || id;
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  return {
    id,
    label,
    baseUrl,
    model: defaultModel,
    configured,
    health,
    stream,
    lastHealth: () => lastHealth,
    metrics: () => ({ ...metrics }),
  };
}

module.exports = { createOpenAICompatibleProvider };
