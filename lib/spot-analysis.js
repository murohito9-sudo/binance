const Decimal = require("decimal.js");

Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_UP });

function positive(value, field) {
  let result;
  try {
    result = new Decimal(value);
  } catch {
    throw new Error(`${field} tidak valid.`);
  }
  if (!result.isFinite() || result.lte(0))
    throw new Error(`${field} tidak valid.`);
  return result;
}

function display(value) {
  const rounded = value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  return rounded
    .toFixed(8)
    .replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, "")
    .replace(/\.$/, "");
}

function calculateStopScenarios({
  candles,
  currentPrice,
  quantity,
  entryPrice,
  riskBudgetUsdt,
}) {
  if (!Array.isArray(candles) || candles.length < 15)
    throw new Error("ATR(14) membutuhkan 15 candle lengkap.");
  const price = positive(currentPrice, "Harga");
  const amount = positive(quantity, "Saldo");
  const entry = positive(entryPrice, "Harga masuk");
  const riskBudget = positive(riskBudgetUsdt, "Anggaran risiko");
  let trueRangeSum = new Decimal(0);
  for (let index = candles.length - 14; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const high = positive(current.high, "High candle");
    const low = positive(current.low, "Low candle");
    const previousClose = positive(previous.close, "Close candle");
    if (high.lt(low)) throw new Error("Data high/low candle tidak konsisten.");
    const range = Decimal.max(
      high.minus(low),
      high.minus(previousClose).abs(),
      low.minus(previousClose).abs(),
    );
    trueRangeSum = trueRangeSum.plus(range);
  }
  const atr = trueRangeSum.div(14);
  if (atr.lte(0))
    throw Object.assign(
      new Error(
        "ATR(14) bernilai nol; data candle tidak cukup untuk skenario harga.",
      ),
      { status: 422 },
    );
  const scenarios = [1.5, 2, 3].map((multiple) => {
    const stop = price.minus(atr.mul(multiple));
    if (stop.lte(0)) {
      return {
        atrMultiple: multiple,
        stopPrice: null,
        distancePct: null,
        estimatedLossUsdt: null,
        overRiskBudget: null,
        status: "invalid_level",
      };
    }
    const distancePct = price.minus(stop).div(price).mul(100);
    const lossPerUnit = Decimal.max(entry.minus(stop), 0);
    const loss = lossPerUnit.mul(amount);
    return {
      atrMultiple: multiple,
      stopPrice: display(stop),
      distancePct: display(distancePct),
      estimatedLossUsdt: display(loss),
      overRiskBudget: loss.gt(riskBudget),
      aboveEntry: stop.gte(entry),
      status: stop.gte(entry) ? "above_entry" : "below_entry",
    };
  });
  return {
    currentPrice: display(price),
    atr14: display(atr),
    scenarios,
  };
}

module.exports = { calculateStopScenarios };
