"use strict";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SENSITIVE_KEY =
  /(authorization|cookie|set-cookie|x-mbx-apikey|x-csrf-token|csrf|api[_-]?key|private[_-]?key|secret|password|passphrase|token)/i;

const MAX_DEPTH = 4;
const MAX_STRING = 400;

function redactString(value) {
  const text = String(value);
  if (text.length <= MAX_STRING) return text;
  return `${text.slice(0, MAX_STRING)}…(${text.length} chars)`;
}

/**
 * Returns a copy of `value` safe to write to logs: sensitive keys are masked,
 * buffers are summarised, functions dropped and depth/length bounded.
 */
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return undefined;
  if (Buffer.isBuffer(value)) return `<buffer ${value.length}b>`;
  if (value instanceof Error)
    return {
      name: value.name,
      message: redactString(value.message),
      status: value.status,
    };
  if (depth >= MAX_DEPTH) return "<max-depth>";
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1);
    }
    return output;
  }
  return undefined;
}

function createLogger({ level = "info", sink = console, now = () => new Date() } = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;

  function write(levelName, event, fields = {}) {
    if (LEVELS[levelName] < threshold) return;
    const line = {
      ts: now().toISOString(),
      level: levelName,
      event: String(event),
      ...sanitize(fields),
    };
    const text = JSON.stringify(line);
    if (levelName === "error") sink.error(text);
    else if (levelName === "warn") sink.warn(text);
    else sink.log(text);
  }

  return {
    level,
    enabled(levelName) {
      return (LEVELS[levelName] ?? LEVELS.info) >= threshold;
    },
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child(baseFields = {}) {
      const bind = (fn) => (event, fields = {}) =>
        fn(event, { ...sanitize(baseFields), ...fields });
      return {
        level,
        enabled: (name) => (LEVELS[name] ?? LEVELS.info) >= threshold,
        debug: bind(write.bind(null, "debug")),
        info: bind(write.bind(null, "info")),
        warn: bind(write.bind(null, "warn")),
        error: bind(write.bind(null, "error")),
      };
    },
  };
}

module.exports = { createLogger, sanitize, LEVELS };
