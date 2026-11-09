import assert from "node:assert/strict";
import { asUsdPair, usdCryptoAssets } from "./alpaca-paper";
import { decide, technicalBuyReady } from "./decision";
import { selectCryptoIdeas, selectNewHits } from "./desk";
import { RANK_MODEL, readIdeas, type RankFigures } from "./rank";
import { settleSleeveIdeas } from "./sleeve";
import { reviewLiveOrder } from "./live-gate";
import { nextCloseRun } from "./week";
import { applyDecisions, emptyBook, markBook } from "./paper";
import { writeResearch } from "./research";
import type { FundamentalReport } from "./fundamentals";
import type { TechnicalReport } from "./technicals";
import { rsi, sma } from "./technicals";

const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
const rsi14 = rsi(closes, 14);
assert.ok(rsi14 != null && Math.abs(rsi14 - 72.98387096774191) < 1e-9, `rsi ${rsi14}`);
assert.equal(sma([1, 2, 3, 4], 4), 2.5);
assert.equal(technicalBuyReady(tech()), true);
assert.equal(technicalBuyReady(tech({ trend: "down" })), false);
assert.equal(technicalBuyReady(tech({ rsi14: 80 })), false);
assert.deepEqual(
  selectNewHits([{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }], new Set(["A"]), 2).map((hit) => hit.symbol),
  ["B", "C"],
);

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
assert.equal(book.startingCash, 50);
assert.equal(book.cash, 50);
const analyses = [
  { symbol: "AAA", decision: buy, technical: tech({ symbol: "AAA", lastClose: 20 }) },
  { symbol: "BBB", decision: buy, technical: tech({ symbol: "BBB", lastClose: 80 }) },
];
const first = applyDecisions(book, analyses, "2026-11-07T00:00:00.000Z");
const bought = first.fills.find((fill) => fill.symbol === "AAA");
assert.equal(bought?.bookAction, "bought");
assert.equal(bought?.shares, 1);
assert.equal(first.book.cash, 30);
const skipped = first.fills.find((fill) => fill.symbol === "BBB");
assert.equal(skipped?.bookAction, "skipped");
assert.equal(skipped?.bookWhy, "Skipped because one share costs more than the remaining cash.");
const again = applyDecisions(first.book, analyses, "2026-11-07T01:00:00.000Z");
assert.equal(again.fills.find((fill) => fill.symbol === "AAA")?.bookAction, "skipped");
const marked = markBook(first.book);
assert.equal(marked.equity, 50);
assert.equal(marked.totalPnl, 0);
const tight = applyDecisions(first.book, [
  { symbol: "CCC", decision: buy, technical: tech({ symbol: "CCC", lastClose: 40 }) },
], "2026-11-07T02:00:00.000Z");
assert.equal(tight.fills[0]?.bookAction, "skipped");
assert.match(tight.fills[0]?.bookWhy ?? "", /one share costs more than the remaining cash/);

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

const sameDay = nextCloseRun(new Date("2026-11-07T03:00:00.000Z"));
assert.equal(sameDay.toISOString(), "2026-11-07T21:30:00.000Z");
const nextDay = nextCloseRun(new Date("2026-11-07T21:30:00.000Z"));
assert.equal(nextDay.toISOString(), "2026-11-08T21:30:00.000Z");

const { deskReason } = await import("./desk-reason");
const { confirmRecommendation } = await import("./desk");
const { submitPaperOrder } = await import("./alpaca-paper");

const ready = deskReason({
  symbol: "KDP",
  action: "buy",
  technical: { asOf: "2026-11-06", lastClose: 36.63, sma20: 35, sma50: 33, rsi14: 52, trend: "up" },
  fundamental: { source: "sec-edgar-companyfacts", netIncome: 100, revenueGrowth: 0.08, trailingPe: 20, marketCap: null },
  orderLine: "One Alpaca paper buy qty 1 day order.",
});
assert.equal(ready.confirmable, true);
assert.match(ready.reason, /Technicals \(Yahoo daily chart/);
assert.match(ready.reason, /Fundamentals \(SEC company facts\)/);

const thin = deskReason({
  symbol: "BTC/USD",
  action: "add",
  technical: { asOf: "2026-11-06", lastClose: 64000, sma20: 60000, sma50: 58000, rsi14: 55, trend: "up" },
  fundamental: { source: "unavailable", netIncome: null, revenueGrowth: null, trailingPe: null, marketCap: null },
  orderLine: "No order was sized.",
});
assert.equal(thin.confirmable, false);
assert.match(thin.reason, /Technicals/);
assert.match(thin.reason, /Fundamentals: missing/);

let called = false;
const noScan = await confirmRecommendation("00000000-0000-4000-8000-000000000000", {}, async () => {
  called = true;
  return new Response("{}", { status: 200 });
});
assert.equal(called, false);
assert.equal(noScan.accepted, false);
assert.ok(noScan.unset.includes("ALPACA_API_KEY"));
assert.ok(noScan.unset.includes("ALPACA_SECRET_KEY"));

const refused = await submitPaperOrder(
  { symbol: "KDP", side: "buy", qty: "1", notional: null, timeInForce: "day", clientOrderId: "mtqtest" },
  { ALPACA_API_KEY: "test-key", ALPACA_SECRET_KEY: "test-secret", ALPACA_PAPER_TRADE: "false" },
  async () => {
    called = true;
    return new Response("{}", { status: 200 });
  },
);
assert.equal(called, false);
assert.equal(refused.accepted, false);
assert.match(refused.blocker ?? "", /ALPACA_PAPER_TRADE/);

const { readFile, writeFile, mkdir, rm } = await import("node:fs/promises");
const { recommendationsPath, dataDir } = await import("./paths");
await mkdir(dataDir, { recursive: true });
let previous = "";
try {
  previous = await readFile(recommendationsPath, "utf8");
} catch {
  previous = "";
}
const fixtureId = "11111111-1111-4111-8111-111111111111";
await writeFile(
  recommendationsPath,
  JSON.stringify({
    recommendations: [
      {
        id: fixtureId,
        symbol: "KDP",
        name: "Keurig Dr Pepper",
        assetClass: "us_equity",
        action: "buy",
        reason: "Buy KDP. Technicals and fundamentals are present in this fixture.",
        confirmable: true,
        blocker: null,
        order: {
          symbol: "KDP",
          assetClass: "us_equity",
          side: "buy",
          qty: "1",
          notional: null,
          timeInForce: "day",
          reason: "fixture",
          estimatedQty: 1,
          estimatedPrice: 36.63,
          estimatedNotional: 36.63,
        },
        status: "recommendation",
        alpacaOrderId: null,
      },
    ],
    report: { ok: true, recommendations: [] },
  }),
);
called = false;
const held = await confirmRecommendation(fixtureId, {}, async () => {
  called = true;
  return new Response("{}", { status: 200 });
});
assert.equal(called, false);
assert.equal(held.accepted, false);
assert.match(held.blocker ?? "", /ALPACA_API_KEY/);
if (previous) await writeFile(recommendationsPath, previous);
else await rm(recommendationsPath, { force: true });

const { dashboardHtml, handleRequest } = await import("../../dashboard/handler");
const pageFile = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.equal(dashboardHtml, pageFile);
const rootPage = await handleRequest(new Request("https://tradingiq.vercel.app/"));
const indexPage = await handleRequest(new Request("https://tradingiq.vercel.app/index.html"));
assert.equal(rootPage.status, 200);
assert.equal(rootPage.headers.get("content-type"), "text/html; charset=utf-8");
assert.equal(await rootPage.text(), await indexPage.text());
assert.match(pageFile, /Scan portfolio/);
const appJs = await readFile(new URL("../../public/app.js", import.meta.url), "utf8");
assert.match(appJs, /Mathematical/);
assert.match(appJs, /AI read did not run/);

assert.equal(asUsdPair("BTCUSD"), "BTC/USD");
assert.equal(asUsdPair("BTC/USD"), "BTC/USD");
assert.equal(asUsdPair("AAPL"), null);
assert.deepEqual(
  usdCryptoAssets([
    { symbol: "BTCUSD", assetClass: "crypto", tradable: true, fractionable: true, minOrderSize: 0.0001, minTradeIncrement: 0.0001 },
    { symbol: "BTC/USD", assetClass: "crypto", tradable: true, fractionable: true, minOrderSize: 0.0001, minTradeIncrement: 0.0001 },
    { symbol: "ETH/USDT", assetClass: "crypto", tradable: true, fractionable: true, minOrderSize: 0.001, minTradeIncrement: 0.001 },
  ]).map((asset) => asset.symbol),
  ["BTC/USD"],
);

const settled = settleSleeveIdeas({
  positionMarketValue: 0,
  slotsLeft: 5,
  kept: [
    { symbol: "AAA", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "BBB", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "CCC", assetClass: "us_equity", action: "buy", notional: 3000 },
  ],
  fresh: [
    { symbol: "DDD", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "EEE", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "FFF", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "BTC/USD", assetClass: "crypto", action: "buy", notional: 3000 },
    { symbol: "ETH/USD", assetClass: "crypto", action: "hold", notional: null },
  ],
});
assert.equal(settled.reserved, 9000);
assert.equal(settled.ideas.filter((idea) => idea.kept).reduce((sum, idea) => sum + (idea.notional ?? 0), 0), 9000);
assert.equal(settled.ideas.reduce((sum, idea) => sum + (idea.notional ?? 0), 0), 15000);
assert.equal(settled.ideas.find((idea) => idea.symbol === "BTC/USD")?.notional, 3000);
assert.equal(settled.ideas.find((idea) => idea.symbol === "ETH/USD")?.notional, null);
assert.ok(settled.ideas.some((idea) => idea.symbol === "ETH/USD"));
assert.equal(settled.ideas.find((idea) => idea.symbol === "EEE")?.notional, null);
assert.equal(settled.ideas.find((idea) => idea.symbol === "FFF")?.notional, null);

const tightSleeve = settleSleeveIdeas({
  positionMarketValue: 12000,
  slotsLeft: 2,
  kept: [
    { symbol: "AAA", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "BBB", assetClass: "us_equity", action: "buy", notional: 3000 },
    { symbol: "CCC", assetClass: "us_equity", action: "buy", notional: 3000 },
  ],
  fresh: [{ symbol: "DDD", assetClass: "us_equity", action: "buy", notional: 3000 }],
});
assert.equal(tightSleeve.reserved, 3000);
assert.equal(tightSleeve.room, 0);
assert.equal(tightSleeve.ideas.filter((idea) => idea.kept).length, 3);
assert.equal(tightSleeve.ideas.find((idea) => idea.symbol === "DDD")?.notional, null);

const cryptoIdeas = selectCryptoIdeas([
  { recommendation: { action: "hold" as const }, symbol: "ETH/USD" },
  { recommendation: { action: "buy" as const }, symbol: "BTC/USD" },
  { recommendation: { action: "hold" as const }, symbol: "SOL/USD" },
], 8);
assert.equal(cryptoIdeas[0]?.symbol, "BTC/USD");
assert.equal(cryptoIdeas.some((row) => row.symbol === "ETH/USD"), true);
assert.equal(selectCryptoIdeas([
  { recommendation: { action: "hold" as const }, symbol: "BTC/USD" },
  { recommendation: { action: "hold" as const }, symbol: "ETH/USD" },
], 8).length, 2);

const rankFigures: RankFigures = {
  asOf: "2026-11-06",
  trend: "up",
  lastClose: 36.63,
  sma20: 35,
  sma50: 33,
  rsi14: 52,
  netIncome: 100,
  revenueGrowth: 0.08,
  trailingPe: 20,
  marketCap: null,
  qty: 1,
  notional: 36.63,
};
let aiCalled = false;
const aiOff = await readIdeas(
  [{ id: "AAA", symbol: "AAA", held: false, figures: rankFigures }],
  { OPENAI_API_KEY: "   " },
  async () => {
    aiCalled = true;
    return new Response("{}", { status: 200 });
  },
);
assert.equal(aiCalled, false);
assert.equal(aiOff.model, "off");
assert.match(aiOff.modelNote, /AI read did not run/);
assert.match(aiOff.modelNote, /mathematical/i);

const rankSecret = "sk-test-rank-key-not-for-logs";
let rankRaw = "";
let rankAuthOk = false;
const read = await readIdeas(
  [
    { id: "STOCK", symbol: "AAA", held: false, figures: rankFigures },
    { id: "COIN", symbol: "BTC/USD", held: false, figures: { ...rankFigures, marketCap: 1000, netIncome: null, revenueGrowth: null, trailingPe: null } },
  ],
  { OPENAI_API_KEY: rankSecret },
  async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    rankRaw = String(init?.body ?? "");
    rankAuthOk = (new Headers(init?.headers).get("authorization") ?? "") === `Bearer ${rankSecret}`;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            rows: [
              { id: "STOCK", action: "hold", sentence: "Close 36.63 is calm and RSI14 is 52." },
              { id: "COIN", action: "buy", sentence: "Close 500 was invented." },
              { id: "GHOST", action: "buy", sentence: "Close 36.63 is fine." },
            ],
          }),
        },
      }],
    }), { status: 200 });
  },
);
assert.equal(rankAuthOk, true);
const rankBody = JSON.parse(rankRaw) as { model: string; reasoning_effort: string; response_format: { type: string } };
assert.equal(rankBody.model, RANK_MODEL);
assert.equal(rankBody.model.includes("mini"), false);
assert.equal(rankBody.reasoning_effort, "none");
assert.equal(rankBody.response_format.type, "json_schema");
assert.equal(rankRaw.includes(rankSecret), false);
assert.equal(read.byId.get("STOCK")?.action, "hold");
assert.match(read.byId.get("STOCK")?.sentence ?? "", /36\.63/);
assert.equal(read.byId.get("COIN")?.action, "buy");
assert.equal(read.byId.get("COIN")?.sentence, null);
assert.equal(read.byId.has("GHOST"), false);
assert.equal(read.modelNote.includes(rankSecret), false);
assert.match(read.modelNote, /disagree/);

const failedRead = await readIdeas(
  [{ id: "AAA", symbol: "AAA", held: true, figures: rankFigures }],
  { OPENAI_API_KEY: rankSecret },
  async () => {
    throw new Error(`network failed ${rankSecret}`);
  },
);
assert.equal(failedRead.model, "unavailable");
assert.match(failedRead.modelNote, /mathematical/);
assert.equal(failedRead.modelNote.includes(rankSecret), false);

console.log("selfcheck ok");
