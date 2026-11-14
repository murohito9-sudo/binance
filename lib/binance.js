const crypto = require("node:crypto");
const Decimal = require("decimal.js");
const { calculateStopScenarios } = require("./spot-analysis");
const { calculateTechnicalIndicators } = require("./spot-analysis");
const BINANCE = "https://api.binance.com";
const INTERVALS = new Set(["1h", "4h", "1d"]);
const INTERVAL_MS = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function binanceError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function configurationStatus() {
  const missing = [];
  const invalid = [];
  const apiKey = String(process.env.BINANCE_API_KEY || "").trim();
  const pem = String(process.env.BINANCE_ED25519_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!apiKey) missing.push("BINANCE_API_KEY");
  if (!pem) missing.push("BINANCE_ED25519_PRIVATE_KEY");
  else {
    try {
      const privateKey = crypto.createPrivateKey(pem);
      if (privateKey.asymmetricKeyType !== "ed25519")
        invalid.push("BINANCE_ED25519_PRIVATE_KEY");
    } catch {
      invalid.push("BINANCE_ED25519_PRIVATE_KEY");
    }
  }
  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

function isConfigured() {
  return configurationStatus().configured;
}

function loadCredentials() {
  const apiKey = process.env.BINANCE_API_KEY;
  const pem = process.env.BINANCE_ED25519_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  ).trim();
  if (!apiKey || !pem)
    throw binanceError(
      "Kredensial Binance baca-saja belum dikonfigurasi. Tambahkan API key dan kunci privat Ed25519 melalui secrets proyek, bukan di chat.",
      503,
    );
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(pem);
  } catch {
    throw binanceError(
      "Format kunci Ed25519 Binance tidak valid. Periksa secret proyek.",
      503,
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw binanceError(
      "Nalar hanya menerima kunci Ed25519 untuk akses Binance baca-saja.",
      503,
    );
  return { apiKey, privateKey };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", ...(options.headers || {}) },
      cache: "no-store",
    });
  } catch {
    throw binanceError(
      "Binance tidak dapat dihubungi saat ini. Coba lagi nanti.",
      502,
    );
  }
  const data = parseJson(await response.text());
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500)
      throw binanceError(
        "Binance sedang membatasi atau mengalami gangguan. Coba lagi nanti.",
        502,
      );
    if (response.status === 401 || response.status === 403)
      throw binanceError(
        "Binance menolak akses baca. Periksa API key, izin baca, IP allowlist, dan kunci Ed25519.",
        403,
      );
    throw binanceError(
      "Binance tidak mengembalikan data yang dapat digunakan. Periksa pasangan Spot dan konfigurasi.",
      422,
    );
  }
  if (!data) throw binanceError("Respons Binance tidak dapat dibaca.", 502);
  return data;
}

async function signedAccount() {
  const { apiKey, privateKey } = loadCredentials();
  const params = new URLSearchParams({
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  const query = params.toString();
  let signature;
  try {
    signature = crypto
      .sign(null, Buffer.from(query, "utf8"), privateKey)
      .toString("base64");
  } catch {
    throw binanceError(
      "Permintaan akun baca-saja tidak dapat ditandatangani.",
      503,
    );
  }
  const url = `${BINANCE}/api/v3/account?${query}&signature=${encodeURIComponent(signature)}`;
  const account = await fetchJson(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!Array.isArray(account.balances))
    throw binanceError(
      "Binance tidak mengembalikan daftar saldo yang valid.",
      502,
    );
  return account;
}

function parseBalance(balance) {
  if (!balance || !/^[A-Z0-9]{1,20}$/.test(String(balance.asset || "")))
    return null;
  try {
    const free = new Decimal(balance.free);
    const locked = new Decimal(balance.locked);
    if (
      !free.isFinite() ||
      !locked.isFinite() ||
      free.isNegative() ||
      locked.isNegative()
    )
      return null;
    const total = free.plus(locked);
    if (total.isZero()) return null;
    return {
      asset: balance.asset,
      free: free.toString(),
      locked: locked.toString(),
      total: total.toString(),
      hasUsdtPair: balance.asset !== "USDT",
    };
  } catch {
    return null;
  }
}

async function syncAccount() {
  const account = await signedAccount();
  const balances = account.balances
    .map(parseBalance)
    .filter(Boolean)
    .sort((a, b) => a.asset.localeCompare(b.asset));
  return {
    balances,
    asOf: new Date().toISOString(),
    source: "Binance Spot",
    scope: "Baca-saja · saldo free + locked · tidak disimpan",
  };
}

function positiveDecimal(value, fieldName, maxLength = 40) {
  const input = String(value ?? "").trim();
  if (input.length > maxLength || !/^\d+(?:\.\d+)?$/.test(input))
    throw binanceError(`${fieldName} harus berupa angka desimal positif.`, 400);
  try {
    const decimal = new Decimal(input);
    if (!decimal.isFinite() || decimal.lte(0)) throw new Error("range");
    return decimal;
  } catch {
    throw binanceError(`${fieldName} harus berupa angka desimal positif.`, 400);
  }
}

async function publicTicker(symbol) {
  const url = new URL(`${BINANCE}/api/v3/ticker/price`);
  url.searchParams.set("symbol", symbol);
  const data = await fetchJson(url, { method: "GET" });
  if (typeof data.price !== "string")
    throw binanceError("Harga Spot tidak tersedia untuk pasangan ini.", 422);
  return data.price;
}

async function publicKlines(symbol, interval) {
  const url = new URL(`${BINANCE}/api/v3/klines`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", "100");
  const rows = await fetchJson(url, { method: "GET" });
  if (!Array.isArray(rows))
    throw binanceError("Candlestick Spot tidak tersedia.", 422);
  const receivedAt = Date.now();
  const candles = rows
    .filter(
      (row) =>
        Array.isArray(row) && row.length >= 7 && Number(row[6]) < receivedAt,
    )
    .map((row) => ({
      openTime: Number(row[0]),
      high: String(row[2]),
      low: String(row[3]),
      close: String(row[4]),
      volume: String(row[5]),
      closeTime: Number(row[6]),
    }))
    .filter(
      (candle) =>
        [candle.openTime, candle.closeTime].every(Number.isFinite) &&
        [candle.high, candle.low, candle.close, candle.volume].every((value) =>
          /^\d+(?:\.\d+)?$/.test(value),
        ) &&
        Number(candle.volume) >= 0,
    );
  if (candles.length < 60)
    throw binanceError(
      "Belum tersedia 60 candle lengkap untuk indikator teknikal.",
      422,
    );
  const last = candles[candles.length - 1];
  const maxAge =
    interval === "1d" ? 30 * 60 * 60_000 : INTERVAL_MS[interval] * 1.5;
  if (receivedAt - last.closeTime > maxAge)
    throw binanceError(
      "Candle Binance terlalu lama untuk analisis ini. Coba lagi saat data terbaru tersedia.",
      422,
    );
  return {
    candles,
    candleCloseTime: new Date(last.closeTime).toISOString(),
    receivedAt,
  };
}

async function analyzeStopLoss({
  asset,
  interval,
  entryPrice,
  riskBudgetUsdt,
}) {
  if (!INTERVALS.has(interval))
    throw binanceError("Pilih timeframe 1 jam, 4 jam, atau 1 hari.", 400);
  const cleanAsset = String(asset || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(cleanAsset) || cleanAsset === "USDT")
    throw binanceError("Pilih aset Spot yang valid dari saldo akun.", 400);
  const entry = positiveDecimal(entryPrice, "Harga masuk rata-rata");
  const riskBudget = positiveDecimal(riskBudgetUsdt, "Batas risiko (USDT)");

  // Read account holdings again so balances sent by the browser are never trusted.
  const [account, tickerPrice, market] = await Promise.all([
    signedAccount(),
    publicTicker(`${cleanAsset}USDT`),
    publicKlines(`${cleanAsset}USDT`, interval),
  ]);
  const balance = account.balances.find((item) => item.asset === cleanAsset);
  if (!balance)
    throw binanceError(
      "Aset ini tidak ada pada daftar saldo Binance saat ini.",
      422,
    );
  const parsedBalance = parseBalance(balance);
  if (!parsedBalance)
    throw binanceError(
      "Saldo aset ini kosong atau tidak valid; Nalar menahan rekomendasi angka.",
      422,
    );
  const result = calculateStopScenarios({
    candles: market.candles,
    currentPrice: tickerPrice,
    quantity: parsedBalance.total,
    entryPrice: entry.toString(),
    riskBudgetUsdt: riskBudget.toString(),
  });
  const indicators = calculateTechnicalIndicators(market.candles);
  return {
    asset: cleanAsset,
    symbol: `${cleanAsset}USDT`,
    interval,
    positionQuantity: parsedBalance.total,
    currentPrice: result.currentPrice,
    entryPrice: entry.toString(),
    riskBudgetUsdt: riskBudget.toString(),
    atr14: result.atr14,
    indicators,
    scenarios: result.scenarios,
    source: "Binance Spot · single-source",
    fetchedAt: new Date(Math.max(Date.now(), market.receivedAt)).toISOString(),
    candleCloseTime: market.candleCloseTime,
    note: "Indikator dihitung dari candle yang sudah ditutup; bias teknikal hanya ringkasan kondisi, bukan perintah buy/sell. Ukuran posisi bersifat teoritis dan belum mencakup biaya, spread, gap, slippage, atau aturan minimum/step Binance. Bukan order atau jaminan.",
  };
}

module.exports = { isConfigured, syncAccount, analyzeStopLoss };

module.exports.configurationStatus = configurationStatus;
