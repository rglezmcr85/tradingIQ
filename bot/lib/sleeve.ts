import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AlpacaAsset } from "./alpaca-paper";
import { dataDir, sleevePath } from "./paths";
import { round2 } from "./paper";

/** Hard cap on buying power this system may use. The rest of the Alpaca account stays untouched. */
export const SLEEVE_CAP = 15_000;
export const SLEEVE_MAX_POSITIONS = 5;
export const SLEEVE_NAME_BUDGET = 3_000;
export const STOCK_FRACTION_MIN_NOTIONAL = 1;
export const CASH_SKIP = "Skipped because one unit costs more than the remaining sleeve cash.";

export type SleeveAssetClass = "us_equity" | "crypto";

export type SleevePosition = {
  symbol: string;
  assetClass: SleeveAssetClass;
  qty: number;
  avgCost: number;
  costBasis: number;
  markPrice: number;
  lastAction: "buy" | "sell" | "hold" | "add" | null;
  lastWhy: string;
  lastCheckedAt: string | null;
  markAsOf: string | null;
};

export type SleeveNote = {
  at: string;
  symbol: string;
  action: string;
  why: string;
  orderAccepted: boolean | null;
};

export type SleeveOrder = {
  at: string;
  symbol: string;
  side: "buy" | "sell";
  accepted: boolean;
  id: string | null;
  status: string | null;
  blocker: string | null;
};

export type SleeveFile = {
  broker: "alpaca-paper";
  cap: typeof SLEEVE_CAP;
  cash: number;
  positions: SleevePosition[];
  notes: SleeveNote[];
  orders: SleeveOrder[];
  alpacaEquity: number | null;
  alpacaCash: number | null;
  alpacaBuyingPower: number | null;
  updatedAt: string | null;
};

export type SleeveReview = {
  symbol: string;
  assetClass: SleeveAssetClass;
  owned: boolean;
  qty: number;
  costBasis: number;
  action: "buy" | "sell" | "hold" | "add";
  why: string;
  price: number | null;
  markAsOf: string | null;
  fractionable: boolean;
  minOrderSize: number | null;
  minTradeIncrement: number | null;
};

export type PlannedOrder = {
  symbol: string;
  assetClass: SleeveAssetClass;
  side: "buy" | "sell";
  qty: string | null;
  notional: string | null;
  timeInForce: "day" | "gtc";
  reason: string;
  estimatedQty: number;
  estimatedPrice: number;
  estimatedNotional: number;
};

export function emptySleeve(): SleeveFile {
  return {
    broker: "alpaca-paper",
    cap: SLEEVE_CAP,
    cash: SLEEVE_CAP,
    positions: [],
    notes: [],
    orders: [],
    alpacaEquity: null,
    alpacaCash: null,
    alpacaBuyingPower: null,
    updatedAt: null,
  };
}

export async function loadSleeve(): Promise<SleeveFile> {
  try {
    const parsed = JSON.parse(await readFile(sleevePath, "utf8")) as SleeveFile;
    if (parsed.broker !== "alpaca-paper" || parsed.cap !== SLEEVE_CAP || !Array.isArray(parsed.positions)) {
      return emptySleeve();
    }
    return parsed;
  } catch {
    return emptySleeve();
  }
}

export async function saveSleeve(sleeve: SleeveFile): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(sleevePath, JSON.stringify(sleeve, null, 2));
}

export function openCost(sleeve: SleeveFile): number {
  return round2(sleeve.positions.reduce((sum, position) => sum + position.costBasis, 0));
}

/** Cash this system may still deploy. Never more than the cap minus capital already in sleeve positions. */
export function spendable(cash: number, costBasisOpen: number): number {
  return round2(Math.max(0, Math.min(cash, SLEEVE_CAP - costBasisOpen)));
}

export function buyingPowerUsed(sleeve: SleeveFile): number {
  return round2(Math.min(SLEEVE_CAP, openCost(sleeve)));
}

function qtyText(value: number): string {
  return value.toFixed(9).replace(/\.?0+$/, "");
}

function floorToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return value;
  const steps = Math.floor(value / increment + 1e-9);
  return Math.round(steps * increment * 1e9) / 1e9;
}

function nameRoom(costBasis: number): number {
  return round2(Math.max(0, SLEEVE_NAME_BUDGET - costBasis));
}

export function tradabilityFromAsset(asset: AlpacaAsset | null, assetClass: SleeveAssetClass): {
  fractionable: boolean;
  minOrderSize: number | null;
  minTradeIncrement: number | null;
  known: boolean;
} {
  if (!asset) return { fractionable: false, minOrderSize: null, minTradeIncrement: null, known: false };
  return {
    fractionable: asset.fractionable,
    minOrderSize: asset.minOrderSize,
    minTradeIncrement: asset.minTradeIncrement,
    known: true,
  };
}

function sizeBuy(review: SleeveReview, budget: number): { order: PlannedOrder } | { skip: string } {
  const price = review.price;
  if (price == null || !(price > 0)) return { skip: "No completed price, so no order was sent." };
  const room = round2(Math.min(budget, nameRoom(review.costBasis)));
  const timeInForce = review.assetClass === "crypto" ? "gtc" : "day";
  if (!review.fractionable) {
    if (price > budget) return { skip: CASH_SKIP };
    const qty = Math.min(Math.floor(budget / price), Math.floor(nameRoom(review.costBasis) / price));
    if (qty < 1) return { skip: `Name budget is ${SLEEVE_NAME_BUDGET}.` };
    return {
      order: {
        symbol: review.symbol,
        assetClass: review.assetClass,
        side: "buy",
        qty: String(qty),
        notional: null,
        timeInForce,
        reason: review.why,
        estimatedQty: qty,
        estimatedPrice: price,
        estimatedNotional: round2(qty * price),
      },
    };
  }
  if (review.assetClass === "crypto") {
    if (review.minOrderSize == null || !(review.minOrderSize > 0)) {
      return { skip: "Alpaca did not return a minimum crypto order size, so the name was skipped." };
    }
    const unit = review.minOrderSize * price;
    if (unit > budget) return { skip: CASH_SKIP };
    const increment =
      review.minTradeIncrement != null && review.minTradeIncrement > 0
        ? review.minTradeIncrement
        : review.minOrderSize;
    let qty = floorToIncrement(room / price, increment);
    while (qty > 0 && qty * price > budget + 1e-8) qty = floorToIncrement(qty - increment, increment);
    if (qty < review.minOrderSize) {
      return unit > nameRoom(review.costBasis) && unit <= budget
        ? { skip: `Name budget is ${SLEEVE_NAME_BUDGET}.` }
        : { skip: CASH_SKIP };
    }
    return {
      order: {
        symbol: review.symbol,
        assetClass: review.assetClass,
        side: "buy",
        qty: qtyText(qty),
        notional: null,
        timeInForce,
        reason: review.why,
        estimatedQty: qty,
        estimatedPrice: price,
        estimatedNotional: round2(qty * price),
      },
    };
  }
  if (STOCK_FRACTION_MIN_NOTIONAL > budget) return { skip: CASH_SKIP };
  if (room < STOCK_FRACTION_MIN_NOTIONAL) return { skip: `Name budget is ${SLEEVE_NAME_BUDGET}.` };
  const notional = round2(Math.min(room, budget));
  return {
    order: {
      symbol: review.symbol,
      assetClass: review.assetClass,
      side: "buy",
      qty: null,
      notional: notional.toFixed(2),
      timeInForce,
      reason: review.why,
      estimatedQty: notional / price,
      estimatedPrice: price,
      estimatedNotional: notional,
    },
  };
}

export function planSleeve(sleeve: SleeveFile, reviews: SleeveReview[]): {
  sells: PlannedOrder[];
  buys: PlannedOrder[];
  notes: Array<{ symbol: string; action: string; why: string }>;
  blockNewBuys: boolean;
  blockReason: string | null;
} {
  const sells: PlannedOrder[] = [];
  const notes: Array<{ symbol: string; action: string; why: string }> = [];
  const unpriced: string[] = [];
  for (const review of reviews) {
    if (!review.owned || review.action !== "sell") continue;
    if (review.price == null || !(review.price > 0) || !(review.qty > 0)) {
      unpriced.push(review.symbol);
      notes.push({
        symbol: review.symbol,
        action: "sell",
        why: "Sell signal, but there is no completed price, so the sleeve did not order.",
      });
      continue;
    }
    sells.push({
      symbol: review.symbol,
      assetClass: review.assetClass,
      side: "sell",
      qty: qtyText(review.qty),
      notional: null,
      timeInForce: review.assetClass === "crypto" ? "gtc" : "day",
      reason: review.why,
      estimatedQty: review.qty,
      estimatedPrice: review.price,
      estimatedNotional: round2(review.qty * review.price),
    });
  }
  const blockNewBuys = unpriced.length > 0;
  const blockReason = blockNewBuys
    ? `Not opened. A position that should be sold was not sold: ${unpriced.join(", ")}.`
    : null;
  let cash = sleeve.cash;
  let cost = openCost(sleeve);
  for (const sell of sells) {
    const position = sleeve.positions.find((item) => item.symbol === sell.symbol);
    cash = round2(cash + sell.estimatedNotional);
    cost = round2(cost - (position?.costBasis ?? 0));
  }
  let budget = spendable(cash, Math.max(0, cost));
  let slots = sleeve.positions.length - sells.length;
  const buys: PlannedOrder[] = [];
  if (!blockNewBuys) {
    for (const review of reviews) {
      if (review.action !== "buy" && review.action !== "add") continue;
      if (review.action === "buy" && review.owned) continue;
      if (review.action === "add" && !review.owned) continue;
      if (review.action === "buy") {
        if (slots >= SLEEVE_MAX_POSITIONS) {
          notes.push({ symbol: review.symbol, action: "buy", why: `Position cap is ${SLEEVE_MAX_POSITIONS}.` });
          continue;
        }
      }
      const sized = sizeBuy(review, budget);
      if ("skip" in sized) {
        notes.push({ symbol: review.symbol, action: review.action, why: sized.skip });
        continue;
      }
      buys.push(sized.order);
      budget = round2(budget - sized.order.estimatedNotional);
      if (review.action === "buy") slots += 1;
    }
  } else {
    for (const review of reviews) {
      if (review.action === "buy" || review.action === "add") {
        notes.push({ symbol: review.symbol, action: review.action, why: blockReason ?? CASH_SKIP });
      }
    }
  }
  for (const review of reviews) {
    if (review.action === "hold") notes.push({ symbol: review.symbol, action: "hold", why: review.why });
  }
  return { sells, buys, notes, blockNewBuys, blockReason };
}

export function applyAcceptedOrder(
  sleeve: SleeveFile,
  order: PlannedOrder,
  fill: { qty: number; price: number; at: string; id: string | null; status: string | null },
): SleeveFile {
  const next: SleeveFile = {
    ...sleeve,
    positions: sleeve.positions.map((position) => ({ ...position })),
    notes: [...sleeve.notes],
    orders: [...sleeve.orders],
  };
  const qty = fill.qty;
  const price = fill.price;
  if (!(qty > 0) || !(price > 0)) return next;
  if (order.side === "buy") {
    const cost = round2(qty * price);
    next.cash = round2(next.cash - cost);
    const existing = next.positions.find((position) => position.symbol === order.symbol);
    if (existing) {
      const totalQty = existing.qty + qty;
      existing.avgCost = (existing.costBasis + cost) / totalQty;
      existing.qty = totalQty;
      existing.costBasis = round2(existing.costBasis + cost);
      existing.markPrice = price;
      existing.lastAction = "add";
      existing.lastWhy = order.reason;
      existing.lastCheckedAt = fill.at;
    } else {
      next.positions.push({
        symbol: order.symbol,
        assetClass: order.assetClass,
        qty,
        avgCost: price,
        costBasis: cost,
        markPrice: price,
        lastAction: "buy",
        lastWhy: order.reason,
        lastCheckedAt: fill.at,
        markAsOf: null,
      });
    }
  } else {
    const index = next.positions.findIndex((position) => position.symbol === order.symbol);
    if (index >= 0) {
      const position = next.positions[index];
      const sold = Math.min(position.qty, qty);
      const proceeds = round2(sold * price);
      next.cash = round2(next.cash + proceeds);
      position.qty = Math.round((position.qty - sold) * 1e9) / 1e9;
      position.costBasis = round2(position.avgCost * position.qty);
      position.markPrice = price;
      position.lastAction = "sell";
      position.lastWhy = order.reason;
      position.lastCheckedAt = fill.at;
      if (position.qty <= 1e-9) next.positions.splice(index, 1);
    }
  }
  next.orders.push({
    at: fill.at,
    symbol: order.symbol,
    side: order.side,
    accepted: true,
    id: fill.id,
    status: fill.status,
    blocker: null,
  });
  next.updatedAt = fill.at;
  return next;
}
