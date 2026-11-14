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

function display(value, places = 8) {
  const decimal = value instanceof Decimal ? value : new Decimal(value);
  const rounded = decimal.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  return rounded
    .toFixed(places)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

function candleNumber(value, field, { allowZero = false } = {}) {
  const text = String(value ?? "");
  if (text.length > 40 || !/^\d+(?:\.\d+)?$/.test(text))
    throw new Error(`${field} candle tidak valid.`);
  const number = Number(text);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0))
    throw new Error(`${field} candle tidak valid.`);
  return number;
}

function emaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let index = 0; index < period; index += 1) sum += values[index];
  let ema = sum / period;
  result[period - 1] = ema;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    result[index] = ema;
  }
  return result;
}

function calculateRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function calculateTechnicalIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 60)
    throw Object.assign(
      new Error("Indikator membutuhkan sekurangnya 60 candle lengkap."),
      { status: 422 },
    );

  const closes = candles.map((candle) => candleNumber(candle?.close, "Close"));
  const ema20 = emaSeries(closes, 20).at(-1);
  const ema50 = emaSeries(closes, 50).at(-1);
  const rsi14 = calculateRsi(closes, 14);

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes
    .map((_, index) =>
      ema12[index] === null || ema26[index] === null
        ? null
        : ema12[index] - ema26[index],
    )
    .filter((value) => value !== null);
  const macdSignalSeries = emaSeries(macdLine, 9);
  const macdValue = macdLine.at(-1);
  const macdSignal = macdSignalSeries.at(-1);
  const macdHistogram = macdValue - macdSignal;

  const bandWindow = closes.slice(-20);
  const bandMiddle = bandWindow.reduce((sum, value) => sum + value, 0) / 20;
  const variance =
    bandWindow.reduce((sum, value) => sum + (value - bandMiddle) ** 2, 0) / 20;
  const standardDeviation = Math.sqrt(variance);
  const lastClose = closes.at(-1);

  const bullishConditions = [
    lastClose > ema20,
    ema20 > ema50,
    macdValue > macdSignal,
    rsi14 >= 50 && rsi14 < 70,
  ];
  const bearishConditions = [
    lastClose < ema20,
    ema20 < ema50,
    macdValue < macdSignal,
    rsi14 > 30 && rsi14 < 50,
  ];
  const bullishVotes = bullishConditions.filter(Boolean).length;
  const bearishVotes = bearishConditions.filter(Boolean).length;
  const bias =
    bullishVotes >= 3 ? "bullish" : bearishVotes >= 3 ? "bearish" : "mixed";

  let volume = null;
  if (candles.slice(-20).every((candle) => candle?.volume !== undefined)) {
    const volumes = candles
      .slice(-20)
      .map((candle) =>
        candleNumber(candle.volume, "Volume", { allowZero: true }),
      );
    const averageVolume20 = volumes.reduce((sum, value) => sum + value, 0) / 20;
    volume = {
      last: display(volumes.at(-1)),
      average20: display(averageVolume20),
      ratio20:
        averageVolume20 > 0
          ? display(volumes.at(-1) / averageVolume20, 2)
          : null,
    };
  }

  return {
    sampleSize: candles.length,
    lastClose: display(lastClose),
    ema20: display(ema20),
    ema50: display(ema50),
    rsi14: display(rsi14, 2),
    macd: {
      value: display(macdValue),
      signal: display(macdSignal),
      histogram: display(macdHistogram),
      aboveSignal: macdValue > macdSignal,
    },
    bollinger: {
      lower: display(bandMiddle - 2 * standardDeviation),
      middle: display(bandMiddle),
      upper: display(bandMiddle + 2 * standardDeviation),
      standardDeviations: 2,
    },
    volume,
    bias,
    votes: { bullish: bullishVotes, bearish: bearishVotes, total: 4 },
  };
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
        maxQuantityForRiskBudget: null,
        maxNotionalAtEntryUsdt: null,
        status: "invalid_level",
      };
    }
    const distancePct = price.minus(stop).div(price).mul(100);
    const lossPerUnit = Decimal.max(entry.minus(stop), 0);
    const loss = lossPerUnit.mul(amount);
    const stopRiskPerUnit = entry.minus(stop);
    const canSizeByRisk = stopRiskPerUnit.gt(0);
    const maxQuantityForRiskBudget = canSizeByRisk
      ? riskBudget.div(stopRiskPerUnit)
      : null;
    return {
      atrMultiple: multiple,
      stopPrice: display(stop),
      distancePct: display(distancePct),
      estimatedLossUsdt: display(loss),
      overRiskBudget: loss.gt(riskBudget),
      aboveEntry: stop.gte(entry),
      maxQuantityForRiskBudget: canSizeByRisk
        ? display(maxQuantityForRiskBudget)
        : null,
      maxNotionalAtEntryUsdt: canSizeByRisk
        ? display(maxQuantityForRiskBudget.mul(entry))
        : null,
      status: stop.gte(entry) ? "at_or_above_entry" : "below_entry",
    };
  });
  return {
    currentPrice: display(price),
    atr14: display(atr),
    scenarios,
  };
}

module.exports = { calculateStopScenarios, calculateTechnicalIndicators };
