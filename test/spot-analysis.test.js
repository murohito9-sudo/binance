const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateStopScenarios } = require("../lib/spot-analysis");

function flatCandles({ high = "110", low = "90", close = "100" } = {}) {
  return Array.from({ length: 15 }, (_, index) => ({
    high,
    low,
    close: index === 0 ? "100" : close,
  }));
}

test("ATR(14) is computed from 14 true ranges and reports three transparent scenarios", () => {
  const result = calculateStopScenarios({
    candles: flatCandles(),
    currentPrice: "100",
    quantity: "2",
    entryPrice: "105",
    riskBudgetUsdt: "100",
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
  assert.equal(result.scenarios[0].estimatedLossUsdt, "70");
  assert.equal(result.scenarios[0].overRiskBudget, false);
});

test("levels over the stated risk budget are explicitly marked", () => {
  const result = calculateStopScenarios({
    candles: flatCandles(),
    currentPrice: "100",
    quantity: "10",
    entryPrice: "110",
    riskBudgetUsdt: "50",
  });
  assert.equal(result.scenarios[0].estimatedLossUsdt, "400");
  assert.equal(result.scenarios[0].overRiskBudget, true);
});

test("levels at or above average entry show zero modeled entry loss, not a profit guarantee", () => {
  const result = calculateStopScenarios({
    candles: flatCandles(),
    currentPrice: "150",
    quantity: "1",
    entryPrice: "100",
    riskBudgetUsdt: "10",
  });
  assert.equal(result.scenarios[0].aboveEntry, true);
  assert.equal(result.scenarios[0].estimatedLossUsdt, "0");
});

test("insufficient candles and non-positive inputs fail closed", () => {
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
