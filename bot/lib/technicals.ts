import { RULES, type Bias, type Trend } from "./rules";

export type DailyBar = {
  date: string;
  close: number;
};

export type TechnicalReport = {
  source: "yahoo-chart";
  symbol: string;
  barCount: number;
  asOf: string | null;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  sma20FiveBarsAgo: number | null;
  sma20Rising: boolean | null;
  rsi14: number | null;
  trend: Trend | "unknown";
  bias: Bias;
  notes: string[];
  closes: number[];
};

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

export function smaEnding(values: number[], period: number, end: number): number | null {
  if (end < period) return null;
  return average(values.slice(end - period, end));
}

/** Wilder RSI. Needs period + 1 closes. */
export function rsi(closes: number[], period = RULES.rsiPeriod): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const relative = avgGain / avgLoss;
  return 100 - 100 / (1 + relative);
}

export function buildTechnicalReport(symbol: string, bars: DailyBar[]): TechnicalReport {
  const closes = bars.map((bar) => bar.close);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const sma20 = sma(closes, RULES.smaFast);
  const sma50 = sma(closes, RULES.smaSlow);
  const sma20FiveBarsAgo =
    closes.length > RULES.smaFast + 5
      ? smaEnding(closes, RULES.smaFast, closes.length - 5)
      : null;
  const sma20Rising =
    sma20 != null && sma20FiveBarsAgo != null ? sma20 > sma20FiveBarsAgo : null;
  const rsi14 = rsi(closes, RULES.rsiPeriod);
  const notes: string[] = [];
  let trend: TechnicalReport["trend"] = "unknown";
  if (bars.length < RULES.minDailyBars || lastClose == null || sma20 == null || sma50 == null) {
    notes.push(`Need ${RULES.minDailyBars} daily closes for SMA50. Pulled ${bars.length}.`);
  } else if (lastClose > sma20 && sma20 > sma50) {
    trend = "up";
    notes.push("Close is above the 20-day average, and that average is above the 50-day.");
  } else if (lastClose < sma20 && sma20 < sma50) {
    trend = "down";
    notes.push("Close is below the 20-day average, and that average is below the 50-day.");
  } else {
    trend = "mixed";
    notes.push("The close and the two averages are not stacked in one direction.");
  }
  if (sma20Rising === true) notes.push("The 20-day average is higher than it was five sessions ago.");
  if (sma20Rising === false) notes.push("The 20-day average is lower than it was five sessions ago.");

  let bias: Bias = "unknown";
  if (trend === "unknown" || rsi14 == null) bias = "unknown";
  else if (trend === "down" || (rsi14 != null && rsi14 >= RULES.rsiExtended) || (sma50 != null && lastClose != null && lastClose < sma50)) {
    bias = "bearish";
  } else if (trend === "up" && rsi14 <= RULES.rsiBuyMax) bias = "bullish";
  else bias = "neutral";

  return {
    source: "yahoo-chart",
    symbol,
    barCount: bars.length,
    asOf: bars.length > 0 ? bars[bars.length - 1].date : null,
    lastClose,
    sma20,
    sma50,
    sma20FiveBarsAgo,
    sma20Rising,
    rsi14,
    trend,
    bias,
    notes,
    closes: closes.slice(-60),
  };
}
