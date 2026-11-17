"use strict";

/**
 * Small in-process fixed-window limiter. Deliberately dependency-free: the app
 * runs as a single container, so a shared store is not required. If the app is
 * ever scaled horizontally this must move to Redis (documented in
 * docs/upgrade-report.md).
 */
function createLimiter({ limit, windowMs, now = () => Date.now() } = {}) {
  const max = Number(limit);
  const span = Number(windowMs);
  if (!Number.isFinite(max) || max <= 0)
    throw new Error("limit harus bilangan positif.");
  if (!Number.isFinite(span) || span <= 0)
    throw new Error("windowMs harus bilangan positif.");

  const buckets = new Map();

  function prune(current) {
    if (buckets.size < 5000) return;
    for (const [key, bucket] of buckets)
      if (bucket.resetAt <= current) buckets.delete(key);
  }

  return {
    limit: max,
    windowMs: span,
    check(key, weight = 1) {
      const current = now();
      const id = String(key || "anonymous");
      let bucket = buckets.get(id);
      if (!bucket || bucket.resetAt <= current) {
        bucket = { count: 0, resetAt: current + span };
        buckets.set(id, bucket);
        prune(current);
      }
      const allowed = bucket.count + weight <= max;
      if (allowed) bucket.count += weight;
      const retryAfterMs = Math.max(0, bucket.resetAt - current);
      return {
        allowed,
        remaining: Math.max(0, max - bucket.count),
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        resetAt: bucket.resetAt,
      };
    },
    reset() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    },
  };
}

module.exports = { createLimiter };
