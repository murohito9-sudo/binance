const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateStopScenarios,
  calculateTechnicalIndicators,
  display,
} = require("../lib/spot-analysis");

function flatCandles({ high = "110", low = "90", close = "100" } = {}) {
  return Array.from({ length: 15 }, (_, index) => ({
    high,
    low,
    close: index === 0 ? "100" : close,
  }));
}

function candlesFromCloses(closes, volumeFn = () => 1) {
  return closes.map((close, index) => ({
    high: String(close + 2),
    low: String(close - 2),
    close: String(close),
    volume: String(volumeFn(index)),
  }));
}

test("ATR(14) reports transparent levels and size bounded by the risk budget", () => {
  const result = calculateStopScenarios({
    candles: flatCandles(),
    currentPrice: "100",
    quantity: "10",
    entryPrice: "110",
    riskBudgetUsdt: "50",
  });
  assert.equal(result.atr14, "20");
  assert.deepEqual(
    result.scenarios.map((item) => item.atrMultiple),
    [1.5, 2, 3],
  );
  assert.deepEqual(
    result.scenarios.map((item) => item.stopPrice),
    ["70", "60", "40"],
  );
  assert.equal(result.scenarios[0].estimatedLossUsdt, "400");
  assert.equal(result.scenarios[0].overRiskBudget, true);
  assert.equal(result.scenarios[0].maxQuantityForRiskBudget, "1.25");
  assert.equal(result.scenarios[0].maxNotionalAtEntryUsdt, "137.5");
});

test("levels at or above average entry do not show unlimited theoretical size", () => {
  const result = calculateStopScenarios({
    candles: flatCandles(),
    currentPrice: "150",
    quantity: "1",
    entryPrice: "100",
    riskBudgetUsdt: "10",
  });
  assert.equal(result.scenarios[0].aboveEntry, true);
  assert.equal(result.scenarios[0].estimatedLossUsdt, "0");
  assert.equal(result.scenarios[0].maxQuantityForRiskBudget, null);
  assert.equal(result.scenarios[0].maxNotionalAtEntryUsdt, null);
});

test("insufficient candles, non-positive inputs and zero ATR fail closed", () => {
  assert.throws(
    () =>
      calculateStopScenarios({
        candles: flatCandles().slice(0, 14),
        currentPrice: "100",
        quantity: "1",
        entryPrice: "100",
        riskBudgetUsdt: "10",
      }),
    /15 candle/,
  );
  assert.throws(
    () =>
      calculateStopScenarios({
        candles: flatCandles(),
        currentPrice: "0",
        quantity: "1",
        entryPrice: "100",
        riskBudgetUsdt: "10",
      }),
    /Harga tidak valid/,
  );
  assert.throws(
    () =>
      calculateStopScenarios({
        candles: flatCandles(),
        currentPrice: "100",
        quantity: "0",
        entryPrice: "100",
        riskBudgetUsdt: "10",
      }),
    /Saldo tidak valid/,
  );
  assert.throws(
    () =>
      calculateStopScenarios({
        candles: flatCandles(),
        currentPrice: "100",
        quantity: "1",
        entryPrice: "100",
        riskBudgetUsdt: "0",
      }),
    /Anggaran risiko tidak valid/,
  );
  assert.throws(
    () =>
      calculateStopScenarios({
        candles: flatCandles({ high: "100", low: "100", close: "100" }),
        currentPrice: "100",
        quantity: "1",
        entryPrice: "100",
        riskBudgetUsdt: "10",
      }),
    /ATR\(14\) bernilai nol/,
  );
});

test("100 rising closes produce consistent trend indicators and volume context", () => {
  const candles = candlesFromCloses(
    Array.from(
      { length: 100 },
      (_, index) => 100 + index + index * index * 0.01,
    ),
    (index) => index + 1,
  );
  const result = calculateTechnicalIndicators(candles);
  assert.equal(result.sampleSize, 100);
  assert.equal(result.bias, "bullish");
  assert.equal(result.rsi14, "100");
  assert.ok(Number(result.ema20) > Number(result.ema50));
  assert.ok(result.macd.aboveSignal);
  assert.ok(Number(result.bollinger.lower) < Number(result.bollinger.middle));
  assert.ok(Number(result.bollinger.middle) < Number(result.bollinger.upper));
  assert.ok(Number(result.volume.ratio20) > 1);
  assert.equal(result.votes.total, 4);
});

test("flat data is mixed and insufficient/invalid indicator samples fail closed", () => {
  const flat = calculateTechnicalIndicators(
    candlesFromCloses(Array(100).fill(100), () => 0),
  );
  assert.equal(flat.bias, "mixed");
  assert.equal(flat.rsi14, "50");
  assert.equal(flat.macd.aboveSignal, false);
  assert.equal(flat.volume.ratio20, null);

  assert.throws(
    () => calculateTechnicalIndicators(candlesFromCloses(Array(59).fill(100))),
    /60 candle lengkap/,
  );
  const invalid = candlesFromCloses(Array(100).fill(100));
  invalid[90].close = "NaN";
  assert.throws(
    () => calculateTechnicalIndicators(invalid),
    /Close candle tidak valid/,
  );
});

test("angka yang tidak terbaca menjadi null, bukan NaN", () => {
  assert.equal(display(null), null);
  assert.equal(display(undefined), null);
  assert.equal(display("bukan-angka"), null);
  assert.equal(display(Number.POSITIVE_INFINITY), null);
  assert.equal(display("1.234567891"), "1.23456789");
  assert.equal(display("2", 2), "2");
});
