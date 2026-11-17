const test = require("node:test");
const assert = require("node:assert/strict");
const { createLimiter } = require("../lib/rate-limit");

test("mengizinkan permintaan sampai batas lalu menolak dengan Retry-After", () => {
  let clock = 1_000;
  const limiter = createLimiter({ limit: 3, windowMs: 60_000, now: () => clock });
  assert.equal(limiter.check("owner").allowed, true);
  assert.equal(limiter.check("owner").allowed, true);
  const third = limiter.check("owner");
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const fourth = limiter.check("owner");
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.retryAfterSeconds, 60);
  clock += 60_001;
  assert.equal(limiter.check("owner").allowed, true);
});

test("kunci berbeda punya kuota terpisah", () => {
  const limiter = createLimiter({ limit: 1, windowMs: 60_000, now: () => 5 });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
  assert.equal(limiter.check("b").allowed, true);
});

test("menolak konfigurasi batas yang tidak valid", () => {
  assert.throws(() => createLimiter({ limit: 0, windowMs: 1000 }), /limit/);
  assert.throws(() => createLimiter({ limit: 1, windowMs: -5 }), /windowMs/);
});
