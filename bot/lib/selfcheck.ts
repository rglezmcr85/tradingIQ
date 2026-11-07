import assert from "node:assert/strict";
import { decide } from "./decision";
import { reviewLiveOrder } from "./live-gate";
import { applyDecisions, emptyBook, markBook } from "./paper";
import { writeResearch } from "./research";
import type { FundamentalReport } from "./fundamentals";
import type { TechnicalReport } from "./technicals";
import { rsi, sma } from "./technicals";

const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
const rsi14 = rsi(closes, 14);
assert.ok(rsi14 != null && Math.abs(rsi14 - 72.98387096774191) < 1e-9, `rsi ${rsi14}`);
assert.equal(sma([1, 2, 3, 4], 4), 2.5);

function tech(overrides: Partial<TechnicalReport> = {}): TechnicalReport {
  return {
    source: "yahoo-chart",
    symbol: "TEST",
    barCount: 80,
    asOf: "2026-11-06",
    lastClose: 110,
    sma20: 105,
    sma50: 100,
    sma20FiveBarsAgo: 103,
    sma20Rising: true,
    rsi14: 55,
    trend: "up",
    bias: "bullish",
    notes: [],
    closes: [110],
    ...overrides,
  };
}

function fund(overrides: Partial<FundamentalReport> = {}): FundamentalReport {
  return {
    source: "sec-edgar-companyfacts",
    symbol: "TEST",
    cik: "0000000001",
    companyName: "Test Co",
    status: "ok",
    unavailableReason: null,
    fiscalYear: 2025,
    periodEnd: "2025-12-31",
    filed: "2026-02-01",
    accession: "0000000001-26-000001",
    revenue: 200,
    priorRevenue: 150,
    priorFiscalYear: 2024,
    revenueGrowth: 0.333,
    netIncome: 40,
    dilutedEps: 5,
    trailingPe: 22,
    netMargin: 0.2,
    bias: "bullish",
    notes: [],
    ...overrides,
  };
}

const bullTech = tech();
const healthy = fund();
const research = writeResearch(bullTech, healthy);
const buy = decide(bullTech, healthy, research);
assert.equal(buy.action, "buy");
assert.equal(buy.bias, "bullish");

const expensive = decide(bullTech, fund({ trailingPe: 55, dilutedEps: 2 }), research);
assert.equal(expensive.action, "hold");
assert.ok(expensive.why.some((line) => line.includes("Cap is 40")));

const down = decide(tech({ trend: "down", lastClose: 90, sma20: 95, sma50: 100, bias: "bearish" }), healthy, research);
assert.equal(down.action, "sell");

const missing = decide(bullTech, fund({ status: "unavailable", source: "unavailable", netIncome: null, revenueGrowth: null, trailingPe: null, dilutedEps: null }), research);
assert.equal(missing.action, "hold");
assert.ok(missing.rules.find((rule) => rule.id === "sec-facts" && rule.pass === false));

const book = emptyBook();
const analyses = [
  { symbol: "AAA", decision: buy, technical: tech({ symbol: "AAA", lastClose: 100 }) },
  { symbol: "BBB", decision: buy, technical: tech({ symbol: "BBB", lastClose: 2500 }) },
];
const first = applyDecisions(book, analyses, "2026-11-07T00:00:00.000Z");
const bought = first.fills.find((fill) => fill.symbol === "AAA");
assert.equal(bought?.bookAction, "bought");
assert.equal(bought?.shares, 10);
assert.equal(first.book.cash, 9000);
const skipped = first.fills.find((fill) => fill.symbol === "BBB");
assert.equal(skipped?.bookAction, "skipped");
const again = applyDecisions(first.book, analyses, "2026-11-07T01:00:00.000Z");
assert.equal(again.fills.find((fill) => fill.symbol === "AAA")?.bookAction, "skipped");
const marked = markBook(first.book);
assert.equal(marked.equity, 10000);
assert.equal(marked.totalPnl, 0);

const blocked = reviewLiveOrder(
  { symbol: "AAPL", asset: "equity", side: "buy", quantity: 1, orderType: "market" },
  {},
);
assert.equal(blocked.placed, false);
assert.equal(blocked.submission, "blocked");
assert.equal(blocked.confirmFlag, false);

const flagged = reviewLiveOrder(
  { symbol: "AAPL", asset: "equity", side: "sell", quantity: 1, orderType: "market" },
  { MYTRADINGIQ_LIVE_ORDERS: "confirm" },
);
assert.equal(flagged.placed, false);
assert.ok(flagged.blockers.some((line) => line.includes("shorts") || line.includes("Sell")));

console.log("selfcheck ok");
