import { delayMs, fetchText } from "./http";
import type { DailyBar } from "./technicals";

type ChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    } | null>;
    error?: { description?: string } | null;
  };
};

export type IntradayBar = {
  at: string;
  close: number;
};

/** Newest 15-minute bar whose interval has fully elapsed. This is not a tick. */
export function lastCompletedIntraday(
  bars: IntradayBar[],
  now: Date,
  intervalMs = 15 * 60 * 1000,
): IntradayBar | null {
  let chosen: IntradayBar | null = null;
  for (const bar of bars) {
    const started = Date.parse(bar.at);
    if (!Number.isFinite(started)) continue;
    if (started + intervalMs <= now.getTime()) chosen = bar;
  }
  return chosen;
}

export function yahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-").replace(/\//g, "-");
}

export async function pullDailyBars(symbol: string): Promise<DailyBar[]> {
  const mapped = yahooSymbol(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}` +
    "?interval=1d&range=1y&includeAdjustedClose=true";
  const body = await fetchText(url);
  const parsed = JSON.parse(body) as ChartResponse;
  const result = parsed.chart?.result?.[0];
  if (!result?.timestamp) {
    const description = parsed.chart?.error?.description ?? "no daily bars";
    throw new Error(`${symbol}: ${description}`);
  }
  const rawClose = result.indicators?.quote?.[0]?.close ?? [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: DailyBar[] = [];
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const price = adjusted[i] ?? rawClose[i];
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const date = new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10);
    bars.push({ date, close: price });
  }
  await delayMs(200);
  return bars;
}

/** Last daily close times that day's volume. Used only to rank, not as a technical input. */
export async function pullDailyDollarVolume(symbol: string): Promise<number | null> {
  const mapped = yahooSymbol(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}` +
    "?interval=1d&range=5d";
  const body = await fetchText(url);
  const parsed = JSON.parse(body) as ChartResponse;
  const result = parsed.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes = result?.indicators?.quote?.[0]?.volume ?? [];
  let dollarVolume: number | null = null;
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const close = closes[i];
    const volume = volumes[i];
    if (close != null && volume != null && close > 0 && volume > 0) {
      dollarVolume = close * volume;
      break;
    }
  }
  await delayMs(200);
  return dollarVolume;
}

/** Delayed 15-minute Yahoo bars. The timestamp is the start of the bar, not a live tick. */
export async function pullIntradayBars(symbol: string): Promise<IntradayBar[]> {
  const mapped = yahooSymbol(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}` +
    "?interval=15m&range=5d";
  const body = await fetchText(url);
  const parsed = JSON.parse(body) as ChartResponse;
  const result = parsed.chart?.result?.[0];
  if (!result?.timestamp) return [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const bars: IntradayBar[] = [];
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ at: new Date(result.timestamp[i] * 1000).toISOString(), close });
  }
  await delayMs(200);
  return bars;
}
