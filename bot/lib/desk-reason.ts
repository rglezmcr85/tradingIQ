/** Written desk reason. A confirmable idea cites a pulled technical number and a pulled fundamental number. */

export type DeskFacts = {
  symbol: string;
  action: "buy" | "add" | "sell";
  technical: {
    asOf: string | null;
    lastClose: number | null;
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    trend: string;
  };
  fundamental: {
    source: "sec-edgar-companyfacts" | "coingecko" | "unavailable";
    netIncome: number | null;
    revenueGrowth: number | null;
    trailingPe: number | null;
    marketCap: number | null;
  };
  orderLine: string;
};

function num(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  return `${(value * 100).toFixed(1)}%`;
}

export function deskReason(facts: DeskFacts): { reason: string; confirmable: boolean } {
  const technicalReady =
    facts.technical.lastClose != null &&
    [facts.technical.sma20, facts.technical.sma50, facts.technical.rsi14].some((value) => value != null);
  const fundamentalReady =
    facts.fundamental.source === "sec-edgar-companyfacts"
      ? [facts.fundamental.netIncome, facts.fundamental.revenueGrowth, facts.fundamental.trailingPe].some(
          (value) => value != null,
        )
      : facts.fundamental.source === "coingecko" && facts.fundamental.marketCap != null;
  const technical = `Technicals (Yahoo daily chart, as of ${facts.technical.asOf ?? "missing"}): trend ${facts.technical.trend}, close ${num(facts.technical.lastClose)}, SMA20 ${num(facts.technical.sma20)}, SMA50 ${num(facts.technical.sma50)}, RSI14 ${num(facts.technical.rsi14, 1)}.`;
  const fundamental =
    facts.fundamental.source === "coingecko"
      ? `Fundamentals (CoinGecko): market cap ${facts.fundamental.marketCap == null ? "missing" : `$${num(facts.fundamental.marketCap, 0)}`}.`
      : facts.fundamental.source === "sec-edgar-companyfacts"
        ? `Fundamentals (SEC company facts): annual revenue growth ${pct(facts.fundamental.revenueGrowth)}, net income ${facts.fundamental.netIncome == null ? "missing" : num(facts.fundamental.netIncome, 0)}, trailing P/E ${num(facts.fundamental.trailingPe, 1)}.`
        : "Fundamentals: missing. No fundamental figure was pulled.";
  const verb = facts.action === "add" ? "Add" : facts.action === "sell" ? "Sell" : "Buy";
  const reason = `${verb} ${facts.symbol}. ${technical} ${fundamental} ${facts.orderLine}`;
  return { reason, confirmable: technicalReady && fundamentalReady };
}
