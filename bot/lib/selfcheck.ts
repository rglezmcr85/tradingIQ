import assert from "node:assert/strict";
import { decide, technicalBuyReady } from "./decision";
import { selectNewHits } from "./desk";
import { MODEL_BUY_CAP, RANK_MODEL, rankPassed, type RankFigures, type RankRow } from "./rank";
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
assert.match(appJs, /modelNote/);

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

function rankRow(id: string, action: RankRow["action"], scope: RankRow["scope"]): RankRow {
  const reason = `${action} ${id}. Rules passed.`;
  return {
    id,
    symbol: id,
    action,
    scope,
    confirmable: true,
    reason,
    order: { reason },
  };
}

function containsSecret(value: unknown, secret: string): boolean {
  return JSON.stringify(value).includes(secret);
}

const rankSecret = "sk-test-rank-key-not-for-logs";
let rankCalled = false;
const unsetRank = await rankPassed(
  [{ row: rankRow("BUY1", "buy", "new"), figures: rankFigures }],
  { OPENAI_API_KEY: "   " },
  async () => {
    rankCalled = true;
    return new Response("{}", { status: 200 });
  },
);
assert.equal(rankCalled, false);
assert.equal(unsetRank.model, "off");
assert.match(unsetRank.modelNote, /OPENAI_API_KEY is unset/);
assert.match(unsetRank.modelNote, /rules only/);
assert.equal(unsetRank.rows.length, 1);
assert.equal(unsetRank.rows[0]?.reason, "buy BUY1. Rules passed.");

const quiet = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
const rankLogs: string[] = [];
console.log = (...args: unknown[]) => {
  rankLogs.push(args.map((item) => String(item)).join(" "));
};
console.error = console.log;
console.warn = console.log;
console.info = console.log;
console.debug = console.log;

const keptSentence = "Close 36.63 is above SMA20 35 with RSI14 52.";
let rankRaw = "";
let rankAuthOk = false;
const ranked = await rankPassed(
  [
    { row: rankRow("SELL1", "sell", "owned"), figures: rankFigures },
    { row: rankRow("ADD1", "add", "owned"), figures: rankFigures },
    { row: rankRow("BUY1", "buy", "new"), figures: rankFigures },
    { row: rankRow("BUY2", "buy", "new"), figures: rankFigures },
    ...Array.from({ length: MODEL_BUY_CAP }, (_, index) => ({
      row: rankRow(`EXTRA${index}`, "buy", "new"),
      figures: rankFigures,
    })),
  ],
  { OPENAI_API_KEY: rankSecret },
  async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    rankRaw = String(init?.body ?? "");
    const header = new Headers(init?.headers).get("authorization") ?? "";
    rankAuthOk = header === `Bearer ${rankSecret}`;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rows: [
                  { id: "SELL1", verdict: "drop", sentence: "Hide this sell even though the close is 36.63." },
                  { id: "ADD1", verdict: "drop", sentence: "Risk note: close 36.63 is extended versus SMA50 33." },
                  { id: "BUY1", verdict: "keep", sentence: keptSentence },
                  { id: "BUY2", verdict: "drop", sentence: "Close 36.63 is fine but drop it." },
                  { id: "NOT-A-CANDIDATE", verdict: "keep", sentence: "Close 999 should be bought." },
                  ...Array.from({ length: MODEL_BUY_CAP }, (_, index) => ({
                    id: `EXTRA${index}`,
                    verdict: "keep",
                    sentence: "Close 999 is invented.",
                  })),
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  },
);
console.log = quiet.log;
console.error = quiet.error;
console.warn = quiet.warn;
console.info = quiet.info;
console.debug = quiet.debug;

assert.equal(rankAuthOk, true);
const rankBody = JSON.parse(rankRaw) as {
  model: string;
  reasoning_effort: string;
  response_format: { type: string };
  messages: Array<{ content?: string }>;
};
assert.equal(rankBody.model, RANK_MODEL);
assert.equal(rankBody.model.includes("mini"), false);
assert.equal(rankBody.reasoning_effort, "none");
assert.equal(rankBody.response_format.type, "json_schema");
assert.equal(containsSecret(rankBody, rankSecret), false);
assert.equal(rankBody.messages.some((message) => message.content?.includes("Rules passed")), false);
assert.equal(containsSecret(rankLogs, rankSecret), false);
assert.equal(containsSecret(ranked, rankSecret), false);
assert.deepEqual(
  ranked.rows.map((row) => row.id),
  ["SELL1", "ADD1", "BUY1", ...Array.from({ length: MODEL_BUY_CAP - 1 }, (_, index) => `EXTRA${index}`)],
);
const sell = ranked.rows.find((row) => row.id === "SELL1");
assert.equal(sell?.confirmable, true);
assert.equal(sell?.action, "sell");
assert.equal(sell?.reason, "sell SELL1. Rules passed.");
const add = ranked.rows.find((row) => row.id === "ADD1");
assert.equal(add?.reason, "add ADD1. Rules passed. Risk note: close 36.63 is extended versus SMA50 33.");
const keptBuy = ranked.rows.find((row) => row.id === "BUY1");
assert.equal(keptBuy?.reason, `buy BUY1. Rules passed. ${keptSentence}`);
assert.equal(keptBuy?.order?.reason, keptBuy?.reason);
assert.equal(ranked.rows.some((row) => row.id === "BUY2" || row.id === "NOT-A-CANDIDATE"), false);
assert.equal(ranked.rows.some((row) => row.reason.includes("999")), false);
assert.equal(ranked.model, "on");
assert.match(ranked.modelNote, /at most 3/);

const failed = await rankPassed(
  [{ row: rankRow("SELL1", "sell", "owned"), figures: rankFigures }, { row: rankRow("BUY1", "buy", "new"), figures: rankFigures }],
  { OPENAI_API_KEY: rankSecret },
  async () => {
    throw new Error(`network failed ${rankSecret}`);
  },
);
assert.equal(failed.model, "unavailable");
assert.match(failed.modelNote, /kept the rule results/);
assert.equal(containsSecret(failed, rankSecret), false);
assert.deepEqual(failed.rows.map((row) => row.id), ["SELL1", "BUY1"]);
assert.equal(failed.rows[0]?.confirmable, true);

console.log("selfcheck ok");
