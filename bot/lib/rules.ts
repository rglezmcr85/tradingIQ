/** Explicit scan, analysis, and paper-account limits. The trader reads these. */

export const RULES = {
  minPrice: 5,
  minShareVolume: 500_000,
  minMarketCap: 2_000_000_000,
  deepAnalysisDefault: 8,
  deepAnalysisMax: 12,
  minDailyBars: 60,
  rsiPeriod: 14,
  smaFast: 20,
  smaSlow: 50,
  rsiBuyMin: 40,
  rsiBuyMax: 65,
  rsiExtended: 75,
  maxTrailingPe: 40,
  startingCash: 50,
  maxPositions: 5,
  /** A new long is one whole share, and only when that share fits in remaining cash. */
  sharesPerBuy: 1,
  maxPositionWeight: 1,
} as const;

export type Bias = "bullish" | "bearish" | "neutral" | "unknown";
export type Action = "buy" | "hold" | "sell";
export type Trend = "up" | "down" | "mixed";
