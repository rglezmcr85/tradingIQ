import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadTickerMap, pullFundamentals, type FundamentalReport } from "./fundamentals";
import { liveGate, type LiveGate } from "./live-gate";
import { applyDecisions, loadBook, markBook, saveBook, type BookFill, type MarkedBook } from "./paper";
import { pullDailyBars } from "./prices";
import { dataDir, lastScanPath } from "./paths";
import { decide, type Decision } from "./decision";
import { writeResearch, type ResearchNote } from "./research";
import { RULES } from "./rules";
import { buildTechnicalReport, type TechnicalReport } from "./technicals";
import { scanUniverse, type ScreenHit } from "./universe";

export type Analysis = {
  symbol: string;
  name: string;
  origin: "scan" | "open-position";
  sector: string;
  industry: string;
  screenLastSale: number | null;
  screenVolume: number | null;
  screenMarketCap: number | null;
  technical: TechnicalReport;
  fundamental: FundamentalReport;
  research: ResearchNote;
  decision: Decision;
  book: BookFill;
};

export type ScanReport = {
  ok: true;
  generatedAt: string;
  universe: {
    source: "nasdaq-trader-symbol-directory";
    screenerSource: "nasdaq-stock-screener";
    priceSource: "yahoo-chart-daily";
    fundamentalSource: "sec-edgar-companyfacts";
    listedCommonStocks: number;
    nasdaqListed: number;
    otherListed: number;
    screenerRows: number;
    passedScreen: number;
    snapshotFetchedAt: string;
    deepAnalysisLimit: number;
    priceCeiling: number;
    affordableNames: number;
    analyzed: string[];
    skipped: Array<{ symbol: string; reason: string }>;
    filters: {
      minPrice: number;
      minShareVolume: number;
      minMarketCap: number;
      exclusions: string;
    };
  };
  rules: {
    rsiBuyMin: number;
    rsiBuyMax: number;
    rsiExtended: number;
    maxTrailingPe: number;
    startingCash: number;
    maxPositions: number;
    sharesPerBuy: number;
    maxPositionWeight: number;
  };
  analyses: Analysis[];
  paper: MarkedBook;
  live: LiveGate;
};

function candidateRows(
  ranked: ScreenHit[],
  openSymbols: string[],
  limit: number,
  priceCeiling: number,
): Array<ScreenHit & { origin: Analysis["origin"] }> {
  const chosen: Array<ScreenHit & { origin: Analysis["origin"] }> = [];
  const seen = new Set<string>();
  for (const symbol of openSymbols) {
    const hit = ranked.find((row) => row.symbol === symbol);
    chosen.push({
      symbol,
      name: hit?.name ?? symbol,
      lastSale: hit?.lastSale ?? 0,
      volume: hit?.volume ?? 0,
      marketCap: hit?.marketCap ?? 0,
      dollarVolume: hit?.dollarVolume ?? 0,
      sector: hit?.sector ?? "",
      industry: hit?.industry ?? "",
      origin: "open-position",
    });
    seen.add(symbol);
  }
  for (const hit of ranked) {
    if (chosen.filter((row) => row.origin === "scan").length >= limit) break;
    if (seen.has(hit.symbol)) continue;
    if (hit.lastSale <= 0 || hit.lastSale > priceCeiling) continue;
    chosen.push({ ...hit, origin: "scan" });
    seen.add(hit.symbol);
  }
  return chosen;
}

export async function runScan(limit: number = RULES.deepAnalysisDefault): Promise<ScanReport> {
  const capped = Math.max(1, Math.min(RULES.deepAnalysisMax, Math.floor(limit)));
  const universe = await scanUniverse();
  const book = await loadBook();
  const openSymbols = book.positions.map((position) => position.symbol);
  const priceCeiling = book.startingCash;
  const pool = candidateRows(universe.ranked, openSymbols, capped + 16, priceCeiling);
  const affordableNames = universe.ranked.filter((row) => row.lastSale > 0 && row.lastSale <= priceCeiling).length;
  const tickers = await loadTickerMap();
  const drafted: Array<Omit<Analysis, "book">> = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  for (const hit of pool) {
    const scanCount = drafted.filter((row) => row.origin === "scan").length;
    if (hit.origin === "scan" && scanCount >= capped) break;
    try {
      console.error(`analyze ${hit.symbol}`);
      const bars = await pullDailyBars(hit.symbol);
      const technical = buildTechnicalReport(hit.symbol, bars);
      if (technical.lastClose == null || technical.barCount < RULES.minDailyBars) {
        skipped.push({ symbol: hit.symbol, reason: `Only ${technical.barCount} daily closes came back.` });
        if (hit.origin === "open-position") {
          drafted.push(await finishDraft(hit, technical, tickers));
        }
        continue;
      }
      drafted.push(await finishDraft(hit, technical, tickers));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "price request failed";
      skipped.push({ symbol: hit.symbol, reason });
    }
  }
  const generatedAt = new Date().toISOString();
  const applied = applyDecisions(
    book,
    drafted.map((row) => ({ symbol: row.symbol, decision: row.decision, technical: row.technical })),
    generatedAt,
  );
  const fills = new Map(applied.fills.map((fill) => [fill.symbol, fill]));
  const analyses: Analysis[] = drafted.map((row) => ({
    ...row,
    book: fills.get(row.symbol) ?? {
      symbol: row.symbol,
      signal: row.decision.action,
      bookAction: "held",
      bookWhy: "No paper fill was recorded.",
      shares: null,
      fillPrice: null,
    },
  }));
  await saveBook(applied.book);
  const report: ScanReport = {
    ok: true,
    generatedAt,
    universe: {
      source: "nasdaq-trader-symbol-directory",
      screenerSource: "nasdaq-stock-screener",
      priceSource: "yahoo-chart-daily",
      fundamentalSource: "sec-edgar-companyfacts",
      listedCommonStocks: universe.listedCommonStocks,
      nasdaqListed: universe.nasdaqListed,
      otherListed: universe.otherListed,
      screenerRows: universe.screenerRows,
      passedScreen: universe.passedScreen,
      snapshotFetchedAt: universe.snapshotFetchedAt,
      deepAnalysisLimit: capped,
      priceCeiling,
      affordableNames,
      analyzed: analyses.map((row) => row.symbol),
      skipped,
      filters: {
        minPrice: RULES.minPrice,
        minShareVolume: RULES.minShareVolume,
        minMarketCap: RULES.minMarketCap,
        exclusions: "ETFs, test issues, warrants, preferreds, rights, units, notes, and blank-check names",
      },
    },
    rules: {
      rsiBuyMin: RULES.rsiBuyMin,
      rsiBuyMax: RULES.rsiBuyMax,
      rsiExtended: RULES.rsiExtended,
      maxTrailingPe: RULES.maxTrailingPe,
      startingCash: RULES.startingCash,
      maxPositions: RULES.maxPositions,
      sharesPerBuy: RULES.sharesPerBuy,
      maxPositionWeight: RULES.maxPositionWeight,
    },
    analyses,
    paper: markBook(applied.book),
    live: liveGate(),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(lastScanPath, JSON.stringify(report));
  return report;
}

async function finishDraft(
  hit: ScreenHit & { origin: Analysis["origin"] },
  technical: TechnicalReport,
  tickers: Awaited<ReturnType<typeof loadTickerMap>>,
): Promise<Omit<Analysis, "book">> {
  const fundamental = await pullFundamentals(hit.symbol, technical.lastClose, tickers);
  const research = writeResearch(technical, fundamental);
  const decision = decide(technical, fundamental, research);
  return {
    symbol: hit.symbol,
    name: hit.name,
    origin: hit.origin,
    sector: hit.sector,
    industry: hit.industry,
    screenLastSale: hit.lastSale > 0 ? hit.lastSale : null,
    screenVolume: hit.volume > 0 ? hit.volume : null,
    screenMarketCap: hit.marketCap > 0 ? hit.marketCap : null,
    technical,
    fundamental,
    research,
    decision,
  };
}

export async function readLastScan(): Promise<ScanReport | null> {
  try {
    const raw = await readFile(lastScanPath, "utf8");
    const parsed = JSON.parse(raw) as ScanReport;
    if (!parsed.ok || !Array.isArray(parsed.analyses)) return null;
    return parsed;
  } catch {
    return null;
  }
}
