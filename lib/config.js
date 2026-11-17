"use strict";

const DEFAULTS = {
  port: 3000,
  providerOrder: "manus,openai-compatible",
  chatPerMinute: 30,
  binancePerMinute: 12,
  uploadPerMinute: 10,
  logLevel: "info",
  requestTimeoutMs: 120000,
  headersTimeoutMs: 30000,
};

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toList(value, fallback) {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback.split(",");
}

/**
 * Reads runtime configuration from an env-like object. Never throws for
 * missing optional values; callers decide what is required for a feature.
 */
function readConfig(env = process.env) {
  return {
    port: toInt(env.PORT, DEFAULTS.port),
    databaseUrl: String(env.DATABASE_URL || ""),
    logLevel: String(env.LOG_LEVEL || DEFAULTS.logLevel).toLowerCase(),
    limits: {
      requestTimeoutMs: toInt(env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
      headersTimeoutMs: toInt(env.HEADERS_TIMEOUT_MS, DEFAULTS.headersTimeoutMs),
    },
    rateLimit: {
      chatPerMinute: toInt(
        env.RATE_LIMIT_CHAT_PER_MINUTE,
        DEFAULTS.chatPerMinute,
      ),
      binancePerMinute: toInt(
        env.RATE_LIMIT_BINANCE_PER_MINUTE,
        DEFAULTS.binancePerMinute,
      ),
      uploadPerMinute: toInt(
        env.RATE_LIMIT_UPLOAD_PER_MINUTE,
        DEFAULTS.uploadPerMinute,
      ),
    },
    ai: {
      providerOrder: toList(env.AI_PROVIDER_ORDER, DEFAULTS.providerOrder),
      timeoutMs: toInt(env.AI_REQUEST_TIMEOUT_MS, 60000),
      providers: [
        {
          id: "manus",
          label: "Manus AI",
          baseUrl: String(env.MANUS_API_URL || ""),
          apiKey: String(env.MANUS_API_KEY || ""),
          model: env.MANUS_MODEL ? String(env.MANUS_MODEL) : null,
          defaultModel: "manus-default",
        },
        {
          id: "openai-compatible",
          label: "OpenAI-compatible",
          baseUrl: String(env.AI_OPENAI_BASE_URL || ""),
          apiKey: String(env.AI_OPENAI_API_KEY || ""),
          model: env.AI_OPENAI_MODEL ? String(env.AI_OPENAI_MODEL) : null,
          defaultModel: "gpt-4o-mini",
        },
      ],
    },
  };
}

module.exports = { readConfig, DEFAULTS };
