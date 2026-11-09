import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  asUsdPair,
  createAlpacaPaper,
  paperCredentials,
  submitPaperOrder,
  type AlpacaAsset,
  type AlpacaPosition,
  type PaperOrderRequest,
} from "./alpaca-paper";
import { deskReason, type DeskFacts } from "./desk-reason";
import { decide, decideCrypto, managePosition, technicalBuyReady, type Decision } from "./decision";
import { loadTickerMap, pullFundamentals, type FundamentalReport } from "./fundamentals";
import { fetchText } from "./http";
import { dataDir, recommendationsPath } from "./paths";
import { pullDailyBars } from "./prices";
import { rankingOffNote, readIdeas, type DeskAction, type RankFigures } from "./rank";
import { writeResearch } from "./research";
import {
  applyAcceptedOrder,
  CASH_SKIP,
  loadSleeve,
  markedSleeveValue,
  orderForNotional,
  planSleeve,
  saveSleeve,
  settleSleeveIdeas,
  SLEEVE_CAP,
  SLEEVE_MAX_POSITIONS,
  spendable,
  openCost,
  type PlannedOrder,
  type SleeveFile,
  type SleeveIdea,
  type SleeveReview,
} from "./sleeve";
import { buildTechnicalReport, type TechnicalReport } from "./technicals";
import { scanUniverse } from "./universe";

const STOCK_WALK = 40;
const CRYPTO_WALK = 24;
const NEW_STOCK_BUYS = 8;
const CRYPTO_SHOW = 8;
const CRYPTO_MAJORS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "BCH", "DOT", "UNI", "SHIB", "TRX", "TON"];
const FUNDAMENTAL_CAP = 12;
const PULL_CONCURRENCY = 4;

export type Recommendation = {
  id: string;
  symbol: string;
  name: string;
  assetClass: "us_equity" | "crypto";
  scope: "owned" | "new";
  /** Mathematical action. The sized order follows this read. */
  action: DeskAction;
  math: { action: DeskAction; reason: string };
  /** Null when the model is off or the call failed. */
  ai: { action: DeskAction; reason: string } | null;
  figures: RankFigures | null;
  reason: string;
  confirmable: boolean;
  blocker: string | null;
  order: PlannedOrder | null;
  status: "recommendation" | "confirmed" | "rejected";
  alpacaOrderId: string | null;
};

export type DeskReport = {
  ok: true;
  generatedAt: string | null;
  configured: boolean;
  unset: string[];
  blocker: string | null;
  cap: typeof SLEEVE_CAP;
  crypto: true;
  alpacaEquity: number | null;
  alpacaBuyingPower: number | null;
  sleeveCash: number;
  buyingPowerUsed: number;
  portfolio: Array<{ symbol: string; qty: number; marketValue: number | null; assetClass: "us_equity" | "crypto" }>;
  /** Held names, including hold. */
  owned: Recommendation[];
  /** Buy ideas from the market scan. Stocks and crypto. Not names he already holds. */
  newNames: Recommendation[];
  market: {
    stocksReviewed: number;
    cryptoReviewed: number;
    newStockBuys: number;
    newCryptoBuys: number;
    note: string | null;
    modelNote: string | null;
    positionMarketValue: number;
    reservedNotional: number;
    sleeveRoom: number;
  };
  recommendations: Recommendation[];
};

type Store = { recommendations: Recommendation[]; report: DeskReport };

function emptyReport(partial: Partial<DeskReport> = {}): DeskReport {
  return {
    ok: true,
    generatedAt: null,
    configured: false,
    unset: [],
    blocker: null,
    cap: SLEEVE_CAP,
    crypto: true,
    alpacaEquity: null,
    alpacaBuyingPower: null,
    sleeveCash: SLEEVE_CAP,
    buyingPowerUsed: 0,
    portfolio: [],
    owned: [],
    newNames: [],
    market: {
      stocksReviewed: 0,
      cryptoReviewed: 0,
      newStockBuys: 0,
      newCryptoBuys: 0,
      note: null,
      modelNote: null,
      positionMarketValue: 0,
      reservedNotional: 0,
      sleeveRoom: SLEEVE_CAP,
    },
    recommendations: [],
    ...partial,
  };
}

let memory: Store | null = null;

async function readStore(): Promise<Store | null> {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(await readFile(recommendationsPath, "utf8")) as Store;
    if (!parsed.report) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readDesk(): Promise<DeskReport> {
  const store = await readStore();
  return store?.report ?? emptyReport();
}

async function writeStore(store: Store): Promise<void> {
  memory = store;
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(recommendationsPath, JSON.stringify(store, null, 2));
  } catch {
    // The in-memory copy still serves this instance when the disk is read-only.
  }
}

function orderRequest(order: PlannedOrder, id: string): PaperOrderRequest {
  return {
    symbol: order.symbol,
    side: order.side,
    qty: order.qty,
    notional: order.notional,
    timeInForce: order.timeInForce,
    clientOrderId: `mtq${id.replace(/-/g, "")}`.slice(0, 48),
  };
}

function orderLine(order: PlannedOrder | null, skip: string | null): string {
  if (!order) {
    return skip ?? "No Alpaca paper order was sized. Nothing will be sent.";
  }
  const size = order.notional != null ? `notional $${order.notional}` : `qty ${order.qty}`;
  return `One Alpaca paper ${order.side} ${size} ${order.timeInForce} order. Nothing is sent until this order is confirmed. The sleeve cap is $${SLEEVE_CAP}. Robinhood is not used.`;
}

async function coinMarketCaps(symbols: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const query = [...new Set(symbols.map((symbol) => symbol.split("/")[0].toLowerCase()).filter(Boolean))];
  if (query.length === 0) return found;
  try {
    const body = await fetchText(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(query.join(","))}&per_page=250`,
    );
    const rows = JSON.parse(body) as Array<{ symbol?: string; market_cap?: number }>;
    for (const row of rows) {
      if (row.symbol && typeof row.market_cap === "number" && Number.isFinite(row.market_cap)) {
        found.set(row.symbol.toLowerCase(), row.market_cap);
      }
    }
  } catch {
    return found;
  }
  return found;
}

function factsFrom(
  symbol: string,
  action: DeskFacts["action"],
  technical: TechnicalReport,
  fundamental: FundamentalReport | null,
  marketCap: number | null,
  order: PlannedOrder | null,
  skip: string | null,
): DeskFacts {
  return {
    symbol,
    action,
    technical: {
      asOf: technical.asOf,
      lastClose: technical.lastClose,
      sma20: technical.sma20,
      sma50: technical.sma50,
      rsi14: technical.rsi14,
      trend: technical.trend,
    },
    fundamental: fundamental
      ? {
          source: fundamental.status === "ok" ? "sec-edgar-companyfacts" : "unavailable",
          netIncome: fundamental.status === "ok" ? fundamental.netIncome : null,
          revenueGrowth: fundamental.status === "ok" ? fundamental.revenueGrowth : null,
          trailingPe: fundamental.status === "ok" ? fundamental.trailingPe : null,
          marketCap: null,
        }
      : {
          source: marketCap != null ? "coingecko" : "unavailable",
          netIncome: null,
          revenueGrowth: null,
          trailingPe: null,
          marketCap,
        },
    orderLine: orderLine(order, skip),
  };
}

function rankFigures(
  technical: TechnicalReport,
  fundamental: FundamentalReport | null,
  marketCap: number | null,
  order: PlannedOrder | null,
): RankFigures {
  const filed = fundamental?.status === "ok" ? fundamental : null;
  return {
    asOf: technical.asOf,
    trend: technical.trend,
    lastClose: technical.lastClose,
    sma20: technical.sma20,
    sma50: technical.sma50,
    rsi14: technical.rsi14,
    netIncome: filed?.netIncome ?? null,
    revenueGrowth: filed?.revenueGrowth ?? null,
    trailingPe: filed?.trailingPe ?? null,
    marketCap,
    qty: order?.estimatedQty ?? null,
    notional: order?.estimatedNotional ?? null,
  };
}

type PassedName = { recommendation: Recommendation; figures: RankFigures };

async function analyzeOwned(input: {
  position: AlpacaPosition;
  asset: AlpacaAsset | null;
  tickers: Awaited<ReturnType<typeof loadTickerMap>>;
  marketCap: number | null;
  sleeveCost: number;
  sleeveQty: number;
  budget: number;
}): Promise<PassedName | null> {
  const symbol = input.position.orderSymbol;
  const bars = await pullDailyBars(symbol);
  const technical = buildTechnicalReport(symbol, bars);
  let decision: Decision;
  let fundamental: FundamentalReport | null = null;
  if (input.position.assetClass === "crypto") {
    decision = decideCrypto(technical);
  } else {
    fundamental = await pullFundamentals(symbol, technical.lastClose, input.tickers);
    decision = decide(technical, fundamental, writeResearch(technical, fundamental));
  }
  const managed = managePosition(decision);
  const price = technical.lastClose;
  const fractionable = input.asset?.fractionable === true;
  const review: SleeveReview = {
    symbol,
    assetClass: input.position.assetClass,
    owned: true,
    qty: input.position.qty,
    costBasis: input.sleeveCost,
    action: managed.action,
    why: managed.why.join(" "),
    price,
    markAsOf: technical.asOf,
    fractionable,
    minOrderSize: input.asset?.minOrderSize ?? null,
    minTradeIncrement: input.asset?.minTradeIncrement ?? null,
  };
  let order: PlannedOrder | null = null;
  let skip: string | null = null;
  if (managed.action === "hold") {
    skip = "Hold. No Alpaca paper order is sized. Nothing will be sent.";
  } else if (managed.action === "sell") {
    if (price == null || !(input.position.qty > 0)) skip = "Sell signal, but there is no completed price, so no order was sized.";
    else {
      order = {
        symbol,
        assetClass: input.position.assetClass,
        side: "sell",
        qty: input.position.qty.toFixed(9).replace(/\.?0+$/, ""),
        notional: null,
        timeInForce: input.position.assetClass === "crypto" ? "gtc" : "day",
        reason: "",
        estimatedQty: input.position.qty,
        estimatedPrice: price,
        estimatedNotional: Math.round(input.position.qty * price * 100) / 100,
      };
    }
  } else {
    const planned = planSleeve(
      { ...emptyOwnedSleeve(input.budget), positions: input.sleeveQty > 0 ? [{
        symbol,
        assetClass: input.position.assetClass,
        qty: input.sleeveQty,
        avgCost: input.sleeveQty > 0 ? input.sleeveCost / input.sleeveQty : 0,
        costBasis: input.sleeveCost,
        markPrice: price ?? 0,
        lastAction: null,
        lastWhy: "",
        lastCheckedAt: null,
        markAsOf: null,
      }] : [] },
      [review],
    );
    order = planned.buys[0] ?? null;
    skip = planned.notes.find((note) => note.symbol === symbol)?.why ?? null;
  }
  const written = deskReason(factsFrom(symbol, managed.action, technical, fundamental, input.marketCap, order, skip));
  if (order) order.reason = written.reason;
  const confirmable = written.confirmable && order != null;
  const shown = confirmable ? order : null;
  return {
    recommendation: {
      id: randomUUID(),
      symbol,
      name: symbol,
      assetClass: input.position.assetClass,
      scope: "owned",
      action: managed.action,
      math: { action: managed.action, reason: written.reason },
      ai: null,
      figures: rankFigures(technical, fundamental, input.marketCap, shown),
      reason: written.reason,
      confirmable,
      blocker: confirmable ? null : (skip ?? "Not confirmable until both a technical figure and a fundamental figure are present."),
      order: shown,
      status: "recommendation",
      alpacaOrderId: null,
    },
    figures: rankFigures(technical, fundamental, input.marketCap, shown),
  };
}

/** Names from a ranked market list that this account does not already hold. */
export function selectNewHits<T extends { symbol: string }>(ranked: T[], owned: ReadonlySet<string>, limit: number): T[] {
  const chosen: T[] = [];
  for (const hit of ranked) {
    if (chosen.length >= limit) break;
    if (!hit.symbol || owned.has(hit.symbol)) continue;
    chosen.push(hit);
  }
  return chosen;
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function emptyOwnedSleeve(cash: number): SleeveFile {
  return {
    broker: "alpaca-paper" as const,
    cap: SLEEVE_CAP,
    cash,
    positions: [],
    notes: [],
    orders: [],
    alpacaEquity: null,
    alpacaCash: null,
    alpacaBuyingPower: null,
    updatedAt: null,
  };
}

export async function runDesk(env: NodeJS.ProcessEnv = process.env): Promise<DeskReport> {
  const creds = paperCredentials(env);
  const sleeve = await loadSleeve();
  if (!creds.ok) {
    const report = emptyReport({
      configured: false,
      unset: creds.unset,
      blocker: creds.blocker,
      sleeveCash: sleeve.cash,
      buyingPowerUsed: Math.min(SLEEVE_CAP, openCost(sleeve)),
      generatedAt: new Date().toISOString(),
      market: {
        stocksReviewed: 0,
        cryptoReviewed: 0,
        newStockBuys: 0,
        newCryptoBuys: 0,
        note: null,
        modelNote: rankingOffNote(env),
        positionMarketValue: 0,
        reservedNotional: 0,
        sleeveRoom: SLEEVE_CAP,
      },
    });
    await writeStore({ recommendations: [], report });
    return report;
  }
  const alpaca = createAlpacaPaper(env);
  const account = await alpaca.account();
  const positions = await alpaca.positions();
  sleeve.alpacaEquity = account.equity;
  sleeve.alpacaCash = account.cash;
  sleeve.alpacaBuyingPower = account.buyingPower;
  sleeve.updatedAt = new Date().toISOString();
  await saveSleeve(sleeve);
  const tickers = await loadTickerMap();
  const cryptoSymbols = positions.filter((position) => position.assetClass === "crypto").map((position) => position.orderSymbol);
  const caps = await coinMarketCaps(cryptoSymbols);
  const ownedPassed: PassedName[] = [];
  const newPassed: PassedName[] = [];
  const budget = spendable(sleeve.cash, openCost(sleeve));
  for (const position of positions) {
    try {
      const asset = await alpaca.asset(position.orderSymbol);
      const held = sleeve.positions.find((item) => item.symbol === position.orderSymbol);
      const marketCap = caps.get(position.orderSymbol.split("/")[0].toLowerCase()) ?? null;
      const passed = await analyzeOwned({
        position,
        asset,
        tickers,
        marketCap,
        sleeveCost: held?.costBasis ?? 0,
        sleeveQty: held?.qty ?? 0,
        budget,
      });
      if (passed) ownedPassed.push(passed);
    } catch {
      // One held name failing does not cancel the market scan.
    }
  }
  const heldSymbols = new Set<string>();
  for (const position of positions) {
    heldSymbols.add(position.symbol);
    heldSymbols.add(position.orderSymbol);
    const pair = asUsdPair(position.orderSymbol) ?? asUsdPair(position.symbol);
    if (pair) {
      heldSymbols.add(pair);
      heldSymbols.add(pair.replace("/", ""));
    }
  }
  const priorOpen = ((await readStore())?.recommendations ?? [])
    .filter((row) => row.status === "recommendation" && row.order != null && (row.action === "buy" || row.action === "add" || row.action === "sell"))
    .map((row) => ({
      ...row,
      order: row.order ? { ...row.order } : null,
      math: row.math ?? { action: row.action, reason: row.reason },
      ai: row.ai ?? null,
      figures: row.figures ?? null,
    }));
  const notes: string[] = [];
  let stocksReviewed = 0;
  let newStockBuys = 0;
  try {
    const universe = await scanUniverse();
    const stockPool = selectNewHits(
      universe.ranked.filter((hit) => hit.lastSale > 0),
      heldSymbols,
      STOCK_WALK,
    );
    const screens = await mapPool(stockPool, PULL_CONCURRENCY, async (hit) => {
      try {
        const technical = buildTechnicalReport(hit.symbol, await pullDailyBars(hit.symbol));
        return technicalBuyReady(technical) ? { hit, technical } : null;
      } catch {
        return null;
      }
    });
    stocksReviewed = stockPool.length;
    let fundamentals = 0;
    for (const pass of screens) {
      if (!pass) continue;
      if (newStockBuys >= NEW_STOCK_BUYS || fundamentals >= FUNDAMENTAL_CAP) break;
      fundamentals += 1;
      let asset: AlpacaAsset | null = null;
      try {
        asset = await alpaca.asset(pass.hit.symbol);
      } catch {
        asset = null;
      }
      const passed = await analyzeNew({
        symbol: pass.hit.symbol,
        name: pass.hit.name,
        assetClass: "us_equity",
        tickers,
        marketCap: pass.hit.marketCap > 0 ? pass.hit.marketCap : null,
        asset,
        budget,
        technical: pass.technical,
      });
      if (passed) {
        newPassed.push(passed);
        newStockBuys += 1;
      }
    }
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "The stock market scan failed.");
  }
  let cryptoReviewed = 0;
  const cryptoPassed: PassedName[] = [];
  try {
    const pairs = await alpaca.cryptoUsdPairs();
    const pairCaps = await coinMarketCaps(pairs.map((pair) => pair.symbol));
    const rankedPairs = [...pairs].sort(
      (a, b) => cryptoSortKey(b.symbol, pairCaps.get(b.symbol.split("/")[0].toLowerCase())) -
        cryptoSortKey(a.symbol, pairCaps.get(a.symbol.split("/")[0].toLowerCase())),
    );
    const cryptoPool = selectNewHits(rankedPairs, heldSymbols, CRYPTO_WALK);
    const screens = await mapPool(cryptoPool, PULL_CONCURRENCY, async (pair) => {
      try {
        const technical = buildTechnicalReport(pair.symbol, await pullDailyBars(pair.symbol));
        return technical.barCount > 0 ? { pair, technical } : null;
      } catch {
        return null;
      }
    });
    cryptoReviewed = cryptoPool.length;
    for (const pass of screens) {
      if (!pass) continue;
      const passed = await analyzeNew({
        symbol: pass.pair.symbol,
        name: pass.pair.symbol,
        assetClass: "crypto",
        tickers,
        marketCap: pairCaps.get(pass.pair.symbol.split("/")[0].toLowerCase()) ?? null,
        asset: pass.pair,
        budget,
        technical: pass.technical,
      });
      if (passed) cryptoPassed.push(passed);
    }
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "The crypto market scan failed.");
  }
  for (const passed of selectCryptoIdeas(cryptoPassed, CRYPTO_SHOW)) newPassed.push(passed);
  const fresh = [...ownedPassed, ...newPassed].map((item) => item.recommendation);
  const freshBySymbol = new Map(fresh.map((row) => [row.symbol, row]));
  const positionMarketValue = markedSleeveValue(
    sleeve,
    positions.map((position) => ({ symbol: position.orderSymbol, marketValue: position.marketValue })),
  );
  const keptNewBuys = priorOpen.filter((row) => row.scope === "new" && row.action === "buy").length;
  const settled = settleSleeveIdeas({
    positionMarketValue,
    slotsLeft: Math.max(0, SLEEVE_MAX_POSITIONS - sleeve.positions.length - keptNewBuys),
    kept: priorOpen.map((row) => toSleeveIdea(row)),
    fresh: fresh.filter((row) => !priorOpen.some((kept) => kept.symbol === row.symbol)).map((row) => toSleeveIdea(row)),
  });
  const recommendations = settled.ideas.map((idea) => {
    const previous = priorOpen.find((row) => row.symbol === idea.symbol);
    const scanned = freshBySymbol.get(idea.symbol);
    const base = previous
      ? {
          ...(scanned ?? previous),
          id: previous.id,
          status: previous.status,
          alpacaOrderId: previous.alpacaOrderId,
          order: scanned?.order ?? previous.order,
          confirmable: scanned?.order ? scanned.confirmable : previous.confirmable,
          math: scanned?.math ?? previous.math ?? { action: previous.action, reason: previous.reason },
          reason: scanned?.reason ?? previous.reason,
          figures: scanned?.figures ?? previous.figures,
          action: scanned?.action ?? previous.action,
        }
      : scanned;
    if (!base) return null;
    return applyBuyNotional(base, idea);
  }).filter((row): row is Recommendation => row != null);
  let modelNote = rankingOffNote(env) ?? "AI read did not run. The mathematical read is shown.";
  try {
    const read = await readIdeas(
      recommendations
        .filter((row) => row.figures)
        .map((row) => ({
          id: row.id,
          symbol: row.symbol,
          held: row.scope === "owned",
          figures: row.figures as RankFigures,
        })),
      env,
    );
    modelNote = read.modelNote;
    if (read.model === "on") {
      for (const row of recommendations) {
        const opinion = read.byId.get(row.id);
        row.ai = opinion
          ? {
              action: opinion.action,
              reason: opinion.sentence ?? "The AI sentence was withheld because it did not cite a fetched figure.",
            }
          : null;
      }
    }
  } catch {
    modelNote = "AI read did not run. The mathematical read is shown.";
  }
  const owned = recommendations.filter((row) => row.scope === "owned");
  const newNames = recommendations.filter((row) => row.scope === "new");
  const keptStockBuys = newNames.filter((row) => row.assetClass === "us_equity" && row.action === "buy").length;
  const keptCryptoBuys = newNames.filter((row) => row.assetClass === "crypto").length;
  const report = emptyReport({
    generatedAt: new Date().toISOString(),
    configured: true,
    cap: SLEEVE_CAP,
    alpacaEquity: account.equity,
    alpacaBuyingPower: account.buyingPower,
    sleeveCash: sleeve.cash,
    buyingPowerUsed: Math.min(SLEEVE_CAP, openCost(sleeve)),
    portfolio: positions.map((position) => ({
      symbol: position.orderSymbol,
      qty: position.qty,
      marketValue: position.marketValue,
      assetClass: position.assetClass,
    })),
    owned,
    newNames,
    market: {
      stocksReviewed,
      cryptoReviewed,
      newStockBuys: keptStockBuys,
      newCryptoBuys: keptCryptoBuys,
      note: notes.length > 0 ? notes.join(" ") : null,
      modelNote,
      positionMarketValue,
      reservedNotional: settled.reserved,
      sleeveRoom: settled.room,
    },
    recommendations,
    blocker: null,
  });
  await writeStore({ recommendations, report });
  return report;
}

function cryptoSortKey(symbol: string, cap: number | undefined): number {
  if (cap != null && cap > 0) return cap;
  const base = symbol.split("/")[0].toUpperCase();
  const index = CRYPTO_MAJORS.indexOf(base);
  return index >= 0 ? CRYPTO_MAJORS.length - index : 0;
}

/** Buy and sell reads stay. Holds fill the card list so a quiet tape still shows crypto. */
export function selectCryptoIdeas<T extends { recommendation: { action: DeskAction } }>(
  rows: T[],
  limit = CRYPTO_SHOW,
): T[] {
  const actionable = rows.filter((row) => row.recommendation.action !== "hold");
  const holds = rows.filter((row) => row.recommendation.action === "hold");
  const chosen = [...actionable];
  const floor = Math.min(4, limit);
  for (const hold of holds) {
    if (chosen.length >= limit) break;
    if (chosen.length >= floor && actionable.length >= floor) break;
    chosen.push(hold);
  }
  if (chosen.length === 0) return holds.slice(0, Math.min(4, limit));
  return chosen.slice(0, limit);
}

function toSleeveIdea(row: Recommendation): SleeveIdea {
  const notional = row.order && (row.action === "buy" || row.action === "add") ? row.order.estimatedNotional : null;
  return { symbol: row.symbol, assetClass: row.assetClass, action: row.action, notional };
}

function applyBuyNotional(row: Recommendation, idea: SleeveIdea & { kept: boolean }): Recommendation {
  const controlsBuy = idea.kept
    ? idea.action === "buy" || idea.action === "add"
    : row.action === "buy" || row.action === "add";
  if (!controlsBuy) return row;
  if (idea.notional == null || !(idea.notional > 0)) {
    return {
      ...row,
      order: null,
      confirmable: false,
      blocker: idea.kept
        ? "Resized below a tradable size under the $15,000 sleeve."
        : "No room left under the $15,000 sleeve.",
    };
  }
  if (!row.order || row.order.side !== "buy") return { ...row, confirmable: false, blocker: row.blocker };
  if (Math.abs(row.order.estimatedNotional - idea.notional) < 0.009) return row;
  const resized = orderForNotional(row.order, idea.notional);
  if (!resized) {
    return { ...row, order: null, confirmable: false, blocker: "The sleeve room left cannot size this order." };
  }
  resized.reason = row.reason;
  return { ...row, order: resized };
}

async function analyzeNew(input: {
  symbol: string;
  name: string;
  assetClass: "us_equity" | "crypto";
  tickers: Awaited<ReturnType<typeof loadTickerMap>>;
  marketCap: number | null;
  asset: AlpacaAsset | null;
  budget: number;
  technical?: TechnicalReport;
}): Promise<PassedName | null> {
  let pulled = input.technical;
  if (!pulled) {
    try {
      pulled = buildTechnicalReport(input.symbol, await pullDailyBars(input.symbol));
    } catch {
      return null;
    }
  }
  if (!pulled) return null;
  const technical = pulled;
  let decision: Decision;
  let fundamental: FundamentalReport | null = null;
  if (input.assetClass === "crypto") decision = decideCrypto(technical);
  else {
    fundamental = await pullFundamentals(input.symbol, technical.lastClose, input.tickers);
    decision = decide(technical, fundamental, writeResearch(technical, fundamental));
  }
  if (input.assetClass !== "crypto" && decision.action !== "buy") return null;
  const mathAction: DeskAction = decision.action === "buy" ? "buy" : decision.action === "sell" ? "sell" : "hold";
  let order: PlannedOrder | null = null;
  let skip: string | null = null;
  if (input.asset?.tradable === false) {
    skip = "Alpaca does not mark this pair tradable. No order was sized.";
  } else if (mathAction === "buy") {
    const review: SleeveReview = {
      symbol: input.symbol,
      assetClass: input.assetClass,
      owned: false,
      qty: 0,
      costBasis: 0,
      action: "buy",
      why: decision.why.join(" "),
      price: technical.lastClose,
      markAsOf: technical.asOf,
      fractionable: input.asset?.fractionable === true,
      minOrderSize: input.asset?.minOrderSize ?? null,
      minTradeIncrement: input.asset?.minTradeIncrement ?? null,
    };
    const planned = planSleeve(emptyOwnedSleeve(input.budget), [review]);
    order = planned.buys[0] ?? null;
    skip = planned.notes.find((note) => note.symbol === input.symbol)?.why ?? (order ? null : CASH_SKIP);
  } else {
    skip = "No Alpaca paper order is sized. Nothing will be sent.";
  }
  const written = deskReason(factsFrom(input.symbol, mathAction, technical, fundamental, input.marketCap, order, skip));
  if (order) order.reason = written.reason;
  const confirmable = written.confirmable && order != null;
  const shown = confirmable ? order : null;
  const figures = rankFigures(technical, fundamental, input.marketCap, shown);
  return {
    recommendation: {
      id: randomUUID(),
      symbol: input.symbol,
      name: input.name,
      assetClass: input.assetClass,
      scope: "new",
      action: mathAction,
      math: { action: mathAction, reason: written.reason },
      ai: null,
      figures,
      reason: written.reason,
      confirmable,
      blocker: confirmable ? null : (skip ?? "Not confirmable until both a technical figure and a fundamental figure are present."),
      order: shown,
      status: "recommendation",
      alpacaOrderId: null,
    },
    figures,
  };
}

export async function confirmRecommendation(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accepted: boolean; unset: string[]; blocker: string | null; recommendation: Recommendation | null }> {
  const creds = paperCredentials(env);
  const store = await readStore();
  if (!store) {
    return { accepted: false, unset: creds.ok ? [] : creds.unset, blocker: "No scan is loaded. Run Scan portfolio first.", recommendation: null };
  }
  const recommendation = store.recommendations.find((item) => item.id === id) ?? null;
  if (!recommendation) {
    return { accepted: false, unset: creds.ok ? [] : creds.unset, blocker: "That recommendation is not on the board.", recommendation: null };
  }
  if (recommendation.status !== "recommendation") {
    return { accepted: false, unset: creds.ok ? [] : creds.unset, blocker: "That order was already confirmed or rejected.", recommendation };
  }
  if (!recommendation.confirmable || !recommendation.order) {
    return {
      accepted: false,
      unset: creds.ok ? [] : creds.unset,
      blocker: recommendation.blocker ?? "This idea stays a recommendation.",
      recommendation,
    };
  }
  if (!creds.ok) {
    return { accepted: false, unset: creds.unset, blocker: creds.blocker, recommendation };
  }
  const sleeve = await loadSleeve();
  if (recommendation.order.side === "buy") {
    const room = spendable(sleeve.cash, openCost(sleeve));
    if (recommendation.order.estimatedNotional > room) {
      return { accepted: false, unset: [], blocker: CASH_SKIP, recommendation };
    }
  }
  const result = await submitPaperOrder(orderRequest(recommendation.order, recommendation.id), env, fetchImpl);
  if (!result.accepted) {
    recommendation.status = "rejected";
    recommendation.blocker = result.blocker;
    await writeStore(store);
    return { accepted: false, unset: [], blocker: result.blocker, recommendation };
  }
  const qty = result.filledQty ?? recommendation.order.estimatedQty;
  const price = result.filledAvgPrice ?? recommendation.order.estimatedPrice;
  const next = applyAcceptedOrder(sleeve, recommendation.order, {
    qty,
    price,
    at: new Date().toISOString(),
    id: result.id,
    status: result.status,
  });
  await saveSleeve(next);
  recommendation.status = "confirmed";
  recommendation.alpacaOrderId = result.id;
  recommendation.blocker = null;
  store.report.sleeveCash = next.cash;
  store.report.buyingPowerUsed = Math.min(SLEEVE_CAP, openCost(next));
  store.report.recommendations = store.recommendations;
  await writeStore(store);
  return { accepted: true, unset: [], blocker: null, recommendation };
}
