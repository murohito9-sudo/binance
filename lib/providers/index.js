"use strict";

const { readConfig } = require("../config");
const { createOpenAICompatibleProvider } = require("./openai-compatible");

/**
 * Provider registry: builds every configured adapter, keeps the configured
 * priority order, and streams a chat completion with a single fallback attempt
 * when the first provider fails *before* emitting any text.
 */
function createProviderRegistry(config = readConfig()) {
  const providers = config.ai.providers
    .map((spec) => createOpenAICompatibleProvider(spec))
    .filter(Boolean);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const order = config.ai.providerOrder.filter((id) => byId.has(id));

  function ordered() {
    return order.map((id) => byId.get(id));
  }

  function available() {
    return ordered().filter((provider) => provider.configured);
  }

  function describe() {
    return ordered().map((provider) => {
      const health = provider.lastHealth();
      const metrics = provider.metrics();
      return {
        id: provider.id,
        label: provider.label,
        model: provider.model,
        configured: provider.configured,
        reachable: health ? health.ok : null,
        lastCheck: health,
        metrics: {
          requests: metrics.requests,
          successes: metrics.successes,
          failures: metrics.failures,
          lastLatencyMs: metrics.lastLatencyMs,
        },
      };
    });
  }

  async function probe({ timeoutMs = 5000 } = {}) {
    const targets = available();
    const results = await Promise.all(
      targets.map(async (provider) => ({
        id: provider.id,
        ...(await provider.health({ timeoutMs })),
      })),
    );
    return results;
  }

  /**
   * Streams one answer. `onDelta` receives text as it arrives.
   * Returns { provider, model, text, latencyMs, attempts }.
   */
  async function streamChat({
    messages,
    signal,
    onDelta,
    timeoutMs = config.ai.timeoutMs,
    logger,
  }) {
    const candidates = available();
    if (!candidates.length) {
      throw Object.assign(
        new Error(
          "Layanan AI belum terhubung pada runtime ini. Hubungi pemilik untuk mengatur provider.",
        ),
        { status: 503 },
      );
    }

    const attempts = [];
    let lastError = null;
    for (const [index, provider] of candidates.entries()) {
      let emitted = 0;
      const startedAt = Date.now();
      try {
        const result = await provider.stream({
          messages,
          signal,
          timeoutMs,
          onDelta: (delta) => {
            emitted += delta.length;
            onDelta(delta);
          },
        });
        return {
          ...result,
          attempts: attempts.concat({
            provider: provider.id,
            ok: true,
            latencyMs: Date.now() - startedAt,
          }),
        };
      } catch (error) {
        attempts.push({
          provider: provider.id,
          ok: false,
          status: error?.status || 500,
          message: String(error?.message || "unknown").slice(0, 200),
          latencyMs: Date.now() - startedAt,
        });
        lastError = error;
        if (signal?.aborted || error?.aborted) throw error;
        if (emitted > 0) throw error; // never repeat text the user already saw
        const hasNext = index < candidates.length - 1;
        logger?.warn("ai.provider_failed", {
          provider: provider.id,
          status: error?.status,
          fallback: hasNext ? candidates[index + 1].id : null,
        });
        if (!hasNext) break;
      }
    }
    throw lastError || new Error("Layanan AI belum dapat menjawab.");
  }

  return {
    order,
    providers,
    available,
    describe,
    probe,
    streamChat,
    get: (id) => byId.get(id) || null,
  };
}

module.exports = { createProviderRegistry };
