import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { delayMs, fetchText } from "./http";
import { cacheDir } from "./paths";
import { RULES, type Bias } from "./rules";

const TICKER_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK";

export type FundamentalReport = {
  source: "sec-edgar-companyfacts" | "unavailable";
  symbol: string;
  cik: string | null;
  companyName: string | null;
  status: "ok" | "unavailable";
  unavailableReason: string | null;
  fiscalYear: number | null;
  periodEnd: string | null;
  filed: string | null;
  accession: string | null;
  revenue: number | null;
  priorRevenue: number | null;
  priorFiscalYear: number | null;
  revenueGrowth: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
  trailingPe: number | null;
  netMargin: number | null;
  bias: Bias;
  notes: string[];
};

type TickerRow = { cik_str: number; ticker: string; title: string };
type FactPoint = {
  start?: string;
  end?: string;
  val?: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  accn?: string;
  frame?: string;
};
type FactsFile = {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, FactPoint[]> }>;
  };
};

const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
];

function emptyReport(symbol: string, reason: string, companyName: string | null, cik: string | null): FundamentalReport {
  return {
    source: "unavailable",
    symbol,
    cik,
    companyName,
    status: "unavailable",
    unavailableReason: reason,
    fiscalYear: null,
    periodEnd: null,
    filed: null,
    accession: null,
    revenue: null,
    priorRevenue: null,
    priorFiscalYear: null,
    revenueGrowth: null,
    netIncome: null,
    dilutedEps: null,
    trailingPe: null,
    netMargin: null,
    bias: "unknown",
    notes: [reason],
  };
}

export async function loadTickerMap(): Promise<Map<string, { cik: string; title: string }>> {
  await mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "company_tickers.json");
  let body: string;
  try {
    const cached = await readFile(cachePath, "utf8");
    const ageMs = Date.now() - JSON.parse(cached).fetchedAt;
    body = ageMs < 24 * 60 * 60 * 1000 ? cached : "";
  } catch {
    body = "";
  }
  if (!body) {
    const raw = await fetchText(TICKER_URL);
    body = JSON.stringify({ fetchedAt: Date.now(), raw: JSON.parse(raw) });
    await writeFile(cachePath, body);
  }
  const parsed = JSON.parse(body) as { raw: Record<string, TickerRow> };
  const map = new Map<string, { cik: string; title: string }>();
  for (const row of Object.values(parsed.raw)) {
    map.set(row.ticker.toUpperCase(), {
      cik: String(row.cik_str).padStart(10, "0"),
      title: row.title,
    });
  }
  return map;
}

function lookupCik(map: Map<string, { cik: string; title: string }>, symbol: string) {
  const keys = [symbol, symbol.replace(/\./g, "-"), symbol.replace(/-/g, ".")];
  for (const key of keys) {
    const hit = map.get(key.toUpperCase());
    if (hit) return hit;
  }
  return null;
}

function periodDays(point: FactPoint): number | null {
  if (!point.start || !point.end) return null;
  const days = (Date.parse(point.end) - Date.parse(point.start)) / 86_400_000;
  return Number.isFinite(days) ? days : null;
}

/** Latest annual 10-K or 20-F periods, one value per period end. */
function annualPoints(points: FactPoint[] | undefined): FactPoint[] {
  if (!points) return [];
  const byEnd = new Map<string, FactPoint>();
  for (const point of points) {
    if (point.fp !== "FY") continue;
    if (point.form !== "10-K" && point.form !== "20-F") continue;
    if (!point.end || point.val == null || !Number.isFinite(point.val)) continue;
    const days = periodDays(point);
    if (days == null || days < 300 || days > 380) continue;
    const prev = byEnd.get(point.end);
    if (!prev) {
      byEnd.set(point.end, point);
      continue;
    }
    const laterFiled = (point.filed ?? "") > (prev.filed ?? "");
    const sameFiled = (point.filed ?? "") === (prev.filed ?? "");
    if (laterFiled || (sameFiled && point.frame && !prev.frame)) {
      byEnd.set(point.end, point);
    } else if (sameFiled && prev.val !== point.val && Boolean(prev.frame) === Boolean(point.frame)) {
      byEnd.set(point.end, { ...point, val: Number.NaN });
    }
  }
  return [...byEnd.values()]
    .filter((point) => point.val != null && Number.isFinite(point.val))
    .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));
}

function unitPoints(tag: { units?: Record<string, FactPoint[]> } | undefined): FactPoint[] {
  if (!tag?.units) return [];
  const arrays = Object.values(tag.units);
  return arrays.sort((a, b) => b.length - a.length)[0] ?? [];
}

function latestSeries(facts: FactsFile, tags: string[]): FactPoint[] {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  let best: FactPoint[] = [];
  for (const tag of tags) {
    const series = annualPoints(unitPoints(gaap[tag]));
    const bestEnd = best[best.length - 1]?.end ?? "";
    const nextEnd = series[series.length - 1]?.end ?? "";
    if (nextEnd > bestEnd) best = series;
  }
  return best;
}

export async function pullFundamentals(
  symbol: string,
  lastClose: number | null,
  map: Map<string, { cik: string; title: string }>,
): Promise<FundamentalReport> {
  const identity = lookupCik(map, symbol);
  if (!identity) {
    return emptyReport(symbol, "SEC company_tickers has no CIK for this symbol.", null, null);
  }
  await delayMs(150);
  let facts: FactsFile;
  try {
    const body = await fetchText(`${FACTS_URL}${identity.cik}.json`, {}, 45_000);
    facts = JSON.parse(body) as FactsFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : "SEC request failed";
    return emptyReport(symbol, message, identity.title, identity.cik);
  }
  const revenueSeries = latestSeries(facts, REVENUE_TAGS);
  const incomeSeries = latestSeries(facts, ["NetIncomeLoss"]);
  const epsSeries = latestSeries(facts, ["EarningsPerShareDiluted"]);
  const revenue = revenueSeries[revenueSeries.length - 1] ?? null;
  const prior = revenueSeries.length >= 2 ? revenueSeries[revenueSeries.length - 2] : null;
  const income = incomeSeries[incomeSeries.length - 1] ?? null;
  const eps = epsSeries[epsSeries.length - 1] ?? null;
  if (!revenue && !income && !eps) {
    return emptyReport(
      symbol,
      "SEC company facts have no annual 10-K or 20-F revenue, net income, or diluted EPS.",
      identity.title,
      identity.cik,
    );
  }
  const revenueGrowth =
    revenue?.val != null && prior?.val != null && prior.val !== 0
      ? (revenue.val - prior.val) / Math.abs(prior.val)
      : null;
  const dilutedEps = eps?.val ?? null;
  const trailingPe =
    dilutedEps != null && dilutedEps > 0 && lastClose != null && lastClose > 0
      ? lastClose / dilutedEps
      : null;
  const netMargin =
    income?.val != null && revenue?.val != null && revenue.val > 0 ? income.val / revenue.val : null;
  const anchor = revenue ?? income ?? eps;
  const fiscalYear = anchor?.end ? Number(anchor.end.slice(0, 4)) : null;
  const notes: string[] = [];
  if (revenue?.val != null) {
    notes.push(`Annual revenue ${revenue.val} for the year ending ${revenue.end}.`);
  }
  if (revenueGrowth != null && prior) {
    notes.push(`Revenue growth versus the year ending ${prior.end} is ${revenueGrowth}.`);
  }
  if (income?.val != null) notes.push(`Annual net income ${income.val} for the year ending ${income.end}.`);
  if (dilutedEps != null) notes.push(`Diluted EPS ${dilutedEps} for the year ending ${eps?.end}.`);
  if (trailingPe != null) notes.push(`Trailing P/E uses the pulled last close divided by that diluted EPS.`);
  if (trailingPe == null) notes.push("Trailing P/E is unavailable because diluted EPS is missing or not positive.");

  let bias: Bias = "neutral";
  if ((income?.val != null && income.val < 0) || (revenueGrowth != null && revenueGrowth < 0)) bias = "bearish";
  else if (
    income?.val != null &&
    income.val > 0 &&
    revenueGrowth != null &&
    revenueGrowth > 0 &&
    trailingPe != null &&
    trailingPe <= RULES.maxTrailingPe &&
    netMargin != null &&
    netMargin > 0
  ) {
    bias = "bullish";
  }

  return {
    source: "sec-edgar-companyfacts",
    symbol,
    cik: identity.cik,
    companyName: identity.title,
    status: "ok",
    unavailableReason: null,
    fiscalYear,
    periodEnd: anchor?.end ?? null,
    filed: anchor?.filed ?? null,
    accession: anchor?.accn ?? null,
    revenue: revenue?.val ?? null,
    priorRevenue: prior?.val ?? null,
    priorFiscalYear: prior?.end ? Number(prior.end.slice(0, 4)) : null,
    revenueGrowth,
    netIncome: income?.val ?? null,
    dilutedEps,
    trailingPe,
    netMargin,
    bias,
    notes,
  };
}
