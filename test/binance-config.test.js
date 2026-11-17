const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { configurationStatus, parseBalance } = require("../lib/binance");

const originalApiKey = process.env.BINANCE_API_KEY;
const originalPrivateKey = process.env.BINANCE_ED25519_PRIVATE_KEY;

test.afterEach(() => {
  if (originalApiKey === undefined) delete process.env.BINANCE_API_KEY;
  else process.env.BINANCE_API_KEY = originalApiKey;
  if (originalPrivateKey === undefined)
    delete process.env.BINANCE_ED25519_PRIVATE_KEY;
  else process.env.BINANCE_ED25519_PRIVATE_KEY = originalPrivateKey;
});

test("melaporkan nama secret yang belum tersedia, tanpa nilai rahasia", () => {
  delete process.env.BINANCE_API_KEY;
  delete process.env.BINANCE_ED25519_PRIVATE_KEY;
  assert.deepEqual(configurationStatus(), {
    configured: false,
    missing: ["BINANCE_API_KEY", "BINANCE_ED25519_PRIVATE_KEY"],
    invalid: [],
  });
});

test("mengenali pasangan Ed25519 yang terpasang tanpa mengembalikan kredensial", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.BINANCE_API_KEY = "demo-placeholder-not-a-secret";
  process.env.BINANCE_ED25519_PRIVATE_KEY = privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  const status = configurationStatus();
  assert.deepEqual(status, { configured: true, missing: [], invalid: [] });
  assert.equal(
    JSON.stringify(status).includes("demo-placeholder-not-a-secret"),
    false,
  );
  assert.equal(JSON.stringify(status).includes("PRIVATE KEY"), false);
});

test("menandai private key dengan tipe atau format keliru sebagai tidak valid", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  process.env.BINANCE_API_KEY = "demo-placeholder-not-a-secret";
  process.env.BINANCE_ED25519_PRIVATE_KEY = privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  assert.deepEqual(configurationStatus(), {
    configured: false,
    missing: [],
    invalid: ["BINANCE_ED25519_PRIVATE_KEY"],
  });
});

test("menandai pasangan USDT hanya bila simbolnya benar-benar ada", () => {
  const pairs = new Set(["BTCUSDT", "ETHUSDT"]);
  const btc = parseBalance({ asset: "BTC", free: "1", locked: "0" }, pairs);
  assert.equal(btc.hasUsdtPair, true);
  const alt = parseBalance({ asset: "FOO", free: "1", locked: "0" }, pairs);
  assert.equal(alt.hasUsdtPair, false);
  const usdt = parseBalance({ asset: "USDT", free: "5", locked: "0" }, pairs);
  assert.equal(usdt.hasUsdtPair, false);
});

test("hasUsdtPair dibiarkan null saat daftar pasangan tidak terbaca", () => {
  const balance = parseBalance({ asset: "BTC", free: "1", locked: "0" }, null);
  assert.equal(balance.hasUsdtPair, null);
  assert.equal(balance.total, "1");
});
