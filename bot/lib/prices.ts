import { delayMs, fetchText } from "./http";
import type { DailyBar } from "./technicals";

type ChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    } | null>;
    error?: { description?: string } | null;
  };
};

export async function pullDailyBars(symbol: string): Promise<DailyBar[]> {
  const yahooSymbol = symbol.replace(/\./g, "-");
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
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
