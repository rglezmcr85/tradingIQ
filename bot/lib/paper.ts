import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Decision } from "./decision";
import { dataDir, paperBookPath } from "./paths";
import { RULES } from "./rules";
import type { TechnicalReport } from "./technicals";

export type PaperPosition = {
  symbol: string;
  shares: number;
  avgCost: number;
  markPrice: number;
  openedAt: string;
};

export type PaperTrade = {
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  fillPrice: number;
  filledAt: string;
  realizedPnl: number;
  why: string;
};

export type PaperBook = {
  account: "paper";
  currency: "USD";
  startingCash: number;
  cash: number;
  maxPositions: number;
  maxPositionWeight: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  updatedAt: string | null;
};

export type BookFill = {
  symbol: string;
  signal: Decision["action"];
  bookAction: "bought" | "sold" | "held" | "skipped";
  bookWhy: string;
  shares: number | null;
  fillPrice: number | null;
};

export type MarkedBook = PaperBook & {
  marketValue: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positions: Array<PaperPosition & { marketValue: number; unrealizedPnl: number }>;
};

export function emptyBook(): PaperBook {
  return {
    account: "paper",
    currency: "USD",
    startingCash: RULES.startingCash,
    cash: RULES.startingCash,
    maxPositions: RULES.maxPositions,
    maxPositionWeight: RULES.maxPositionWeight,
    positions: [],
    trades: [],
    updatedAt: null,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function loadBook(): Promise<PaperBook> {
  try {
    const raw = await readFile(paperBookPath, "utf8");
    const parsed = JSON.parse(raw) as PaperBook;
    if (parsed.account !== "paper" || !Array.isArray(parsed.positions)) return emptyBook();
    return parsed;
  } catch {
    return emptyBook();
  }
}

export async function saveBook(book: PaperBook): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(paperBookPath, JSON.stringify(book, null, 2));
}

export function markBook(book: PaperBook): MarkedBook {
  const positions = book.positions.map((position) => {
    const marketValue = round2(position.shares * position.markPrice);
    const unrealizedPnl = round2((position.markPrice - position.avgCost) * position.shares);
    return { ...position, marketValue, unrealizedPnl };
  });
  const marketValue = round2(positions.reduce((sum, position) => sum + position.marketValue, 0));
  const unrealizedPnl = round2(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  const realizedPnl = round2(
    book.trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.realizedPnl, 0),
  );
  const equity = round2(book.cash + marketValue);
  return {
    ...book,
    positions,
    marketValue,
    equity,
    realizedPnl,
    unrealizedPnl,
    totalPnl: round2(equity - book.startingCash),
  };
}

type Analyzed = {
  symbol: string;
  decision: Decision;
  technical: TechnicalReport;
};

export function applyDecisions(book: PaperBook, analyses: Analyzed[], filledAt: string): { book: PaperBook; fills: BookFill[] } {
  const next: PaperBook = {
    ...book,
    positions: book.positions.map((position) => ({ ...position })),
    trades: [...book.trades],
  };
  const fills: BookFill[] = [];
  const bySymbol = new Map(analyses.map((row) => [row.symbol, row]));
  for (const position of next.positions) {
    const row = bySymbol.get(position.symbol);
    if (row?.technical.lastClose != null) position.markPrice = row.technical.lastClose;
  }
  for (const row of analyses) {
    if (row.decision.action !== "sell") continue;
    if (row.technical.lastClose == null) {
      fills.push({
        symbol: row.symbol,
        signal: "sell",
        bookAction: "skipped",
        bookWhy: "Sell signal, but the daily close was missing, so the paper book did not trade.",
        shares: null,
        fillPrice: null,
      });
      continue;
    }
    const index = next.positions.findIndex((position) => position.symbol === row.symbol);
    if (index < 0) {
      fills.push({
        symbol: row.symbol,
        signal: "sell",
        bookAction: "skipped",
        bookWhy: "Sell signal, and the paper book has no long to close.",
        shares: null,
        fillPrice: null,
      });
      continue;
    }
    const position = next.positions[index];
    const fillPrice = row.technical.lastClose;
    const realizedPnl = round2((fillPrice - position.avgCost) * position.shares);
    next.cash = round2(next.cash + position.shares * fillPrice);
    next.positions.splice(index, 1);
    next.trades.push({
      symbol: row.symbol,
      side: "sell",
      shares: position.shares,
      fillPrice,
      filledAt,
      realizedPnl,
      why: row.decision.why[0] ?? "Sell rule passed.",
    });
    fills.push({
      symbol: row.symbol,
      signal: "sell",
      bookAction: "sold",
      bookWhy: `Sold ${position.shares} shares at the last daily close ${fillPrice}.`,
      shares: position.shares,
      fillPrice,
    });
  }
  for (const row of analyses) {
    if (row.decision.action === "sell") continue;
    if (row.decision.action === "hold" || row.technical.lastClose == null) {
      fills.push({
        symbol: row.symbol,
        signal: row.decision.action,
        bookAction: "held",
        bookWhy: "Hold signal. The paper book does not add or exit.",
        shares: null,
        fillPrice: null,
      });
      continue;
    }
    if (next.positions.some((position) => position.symbol === row.symbol)) {
      fills.push({
        symbol: row.symbol,
        signal: "buy",
        bookAction: "skipped",
        bookWhy: "Already long. The paper book does not add.",
        shares: null,
        fillPrice: null,
      });
      continue;
    }
    if (next.positions.length >= next.maxPositions) {
      fills.push({
        symbol: row.symbol,
        signal: "buy",
        bookAction: "skipped",
        bookWhy: `Position cap is ${next.maxPositions}.`,
        shares: null,
        fillPrice: null,
      });
      continue;
    }
    const equity =
      next.cash + next.positions.reduce((sum, position) => sum + position.shares * position.markPrice, 0);
    const budget = Math.min(next.cash, equity * next.maxPositionWeight);
    const fillPrice = row.technical.lastClose;
    const shares = Math.floor(budget / fillPrice);
    if (shares < 1) {
      fills.push({
        symbol: row.symbol,
        signal: "buy",
        bookAction: "skipped",
        bookWhy: "One share costs more than the 10% size cap or remaining cash.",
        shares: null,
        fillPrice,
      });
      continue;
    }
    const cost = round2(shares * fillPrice);
    next.cash = round2(next.cash - cost);
    next.positions.push({
      symbol: row.symbol,
      shares,
      avgCost: fillPrice,
      markPrice: fillPrice,
      openedAt: filledAt,
    });
    next.trades.push({
      symbol: row.symbol,
      side: "buy",
      shares,
      fillPrice,
      filledAt,
      realizedPnl: 0,
      why: row.decision.why[0] ?? "Buy rules passed.",
    });
    fills.push({
      symbol: row.symbol,
      signal: "buy",
      bookAction: "bought",
      bookWhy: `Bought ${shares} shares at the last daily close ${fillPrice}. Size is capped at 10% of paper equity.`,
      shares,
      fillPrice,
    });
  }
  next.updatedAt = filledAt;
  return { book: next, fills };
}
