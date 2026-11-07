/**
 * Alpaca paper trading only. The host is fixed. Live keys and the live host are never used.
 * ALPACA_PAPER_TRADE defaults to true. This module refuses the value false and does not change it.
 */

export const PAPER_ORIGIN = "https://paper-api.alpaca.markets";

const ACCEPTED = new Set([
  "accepted",
  "pending_new",
  "new",
  "accepted_for_bidding",
  "partially_filled",
  "filled",
  "calculated",
]);

export type PaperCredentials =
  | { ok: true; key: string; secret: string }
  | { ok: false; unset: string[]; blocker: string };

export type PaperOrderRequest = {
  symbol: string;
  side: "buy" | "sell";
  qty: string | null;
  notional: string | null;
  timeInForce: "day" | "gtc";
  clientOrderId: string;
};

export type PaperOrderResult = {
  accepted: boolean;
  id: string | null;
  status: string | null;
  filledQty: number | null;
  filledAvgPrice: number | null;
  blocker: string | null;
};

export type AlpacaAsset = {
  symbol: string;
  assetClass: "us_equity" | "crypto";
  tradable: boolean;
  fractionable: boolean;
  minOrderSize: number | null;
  minTradeIncrement: number | null;
};

export type AlpacaAccount = {
  equity: number | null;
  cash: number | null;
  buyingPower: number | null;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function paperCredentials(env: NodeJS.ProcessEnv = process.env): PaperCredentials {
  const paper = env.ALPACA_PAPER_TRADE;
  if (paper != null && paper !== "" && !/^(true|1|yes)$/i.test(paper)) {
    return {
      ok: false,
      unset: [],
      blocker:
        "ALPACA_PAPER_TRADE is not the default true. This build will not send an order and will not set that variable to false.",
    };
  }
  const unset: string[] = [];
  if (!env.ALPACA_API_KEY) unset.push("ALPACA_API_KEY");
  if (!env.ALPACA_SECRET_KEY) unset.push("ALPACA_SECRET_KEY");
  if (unset.length > 0) {
    return {
      ok: false,
      unset,
      blocker: `${unset.join(" and ")} ${unset.length === 1 ? "is" : "are"} unset. No Alpaca paper order was sent.`,
    };
  }
  return { ok: true, key: env.ALPACA_API_KEY ?? "", secret: env.ALPACA_SECRET_KEY ?? "" };
}

function paperUrl(path: string): string {
  const url = new URL(path, PAPER_ORIGIN);
  if (url.origin !== PAPER_ORIGIN) throw new Error("Refusing a non-paper Alpaca URL.");
  return url.toString();
}

function authHeaders(creds: { key: string; secret: string }): Record<string, string> {
  return {
    "APCA-API-KEY-ID": creds.key,
    "APCA-API-SECRET-KEY": creds.secret,
    accept: "application/json",
  };
}

async function readMessage(res: Response): Promise<{ status: number; body: Record<string, unknown> | null; message: string }> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
    return { status: res.status, body, message };
  } catch {
    return { status: res.status, body: null, message: `HTTP ${res.status}` };
  }
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseAsset(raw: Record<string, unknown>): AlpacaAsset | null {
  const symbol = typeof raw.symbol === "string" ? raw.symbol : "";
  if (!symbol) return null;
  const assetClass = raw.class === "crypto" ? "crypto" : "us_equity";
  return {
    symbol,
    assetClass,
    tradable: raw.tradable === true,
    fractionable: raw.fractionable === true,
    minOrderSize: num(raw.min_order_size),
    minTradeIncrement: num(raw.min_trade_increment),
  };
}

export async function submitPaperOrder(
  order: PaperOrderRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<PaperOrderResult> {
  const creds = paperCredentials(env);
  if (!creds.ok) {
    return { accepted: false, id: null, status: null, filledQty: null, filledAvgPrice: null, blocker: creds.blocker };
  }
  if ((order.qty == null) === (order.notional == null)) {
    return {
      accepted: false,
      id: null,
      status: null,
      filledQty: null,
      filledAvgPrice: null,
      blocker: "An Alpaca order needs qty or notional, not both.",
    };
  }
  const url = paperUrl("/v2/orders");
  const payload: Record<string, string> = {
    symbol: order.symbol,
    side: order.side,
    type: "market",
    time_in_force: order.timeInForce,
    client_order_id: order.clientOrderId,
  };
  if (order.qty != null) payload.qty = order.qty;
  if (order.notional != null) payload.notional = order.notional;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { ...authHeaders(creds), "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const parsed = await readMessage(res);
  if (!res.ok || !parsed.body) {
    return { accepted: false, id: null, status: null, filledQty: null, filledAvgPrice: null, blocker: parsed.message };
  }
  const status = typeof parsed.body.status === "string" ? parsed.body.status : null;
  const accepted = status != null && ACCEPTED.has(status);
  return {
    accepted,
    id: typeof parsed.body.id === "string" ? parsed.body.id : null,
    status,
    filledQty: num(parsed.body.filled_qty),
    filledAvgPrice: num(parsed.body.filled_avg_price),
    blocker: accepted ? null : `Alpaca paper did not accept the order (status ${status ?? "missing"}).`,
  };
}

export type AlpacaPosition = {
  symbol: string;
  orderSymbol: string;
  assetClass: "us_equity" | "crypto";
  qty: number;
  avgEntry: number | null;
  marketValue: number | null;
  currentPrice: number | null;
};

export function orderSymbolFor(symbol: string, assetClass: "us_equity" | "crypto"): string {
  if (assetClass === "crypto" && !symbol.includes("/") && symbol.endsWith("USD") && symbol.length > 3) {
    return `${symbol.slice(0, -3)}/USD`;
  }
  return symbol;
}

export function parsePosition(raw: Record<string, unknown>): AlpacaPosition | null {
  const symbol = typeof raw.symbol === "string" ? raw.symbol : "";
  const qty = num(raw.qty);
  if (!symbol || qty == null || qty === 0) return null;
  const assetClass = raw.asset_class === "crypto" ? "crypto" : "us_equity";
  return {
    symbol,
    orderSymbol: orderSymbolFor(symbol, assetClass),
    assetClass,
    qty: Math.abs(qty),
    avgEntry: num(raw.avg_entry_price),
    marketValue: num(raw.market_value),
    currentPrice: num(raw.current_price),
  };
}

export function createAlpacaPaper(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch) {
  const creds = paperCredentials(env);
  if (!creds.ok) throw new Error(creds.blocker);
  const headers = authHeaders(creds);

  async function get(path: string): Promise<unknown> {
    const res = await fetchImpl(paperUrl(path), { headers });
    const parsed = await readMessage(res);
    if (!res.ok || parsed.body == null) throw new Error(parsed.message);
    return parsed.body;
  }

  return {
    async account(): Promise<AlpacaAccount> {
      const body = (await get("/v2/account")) as Record<string, unknown>;
      return {
        equity: num(body.equity),
        cash: num(body.cash),
        buyingPower: num(body.buying_power),
      };
    },
    async asset(symbol: string): Promise<AlpacaAsset | null> {
      try {
        const body = (await get(`/v2/assets/${encodeURIComponent(symbol)}`)) as Record<string, unknown>;
        return parseAsset(body);
      } catch {
        return null;
      }
    },
    async cryptoUsdPairs(): Promise<AlpacaAsset[]> {
      const res = await fetchImpl(paperUrl("/v2/assets?asset_class=crypto&status=active"), {
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = JSON.parse(text) as Record<string, unknown>[];
      return rows
        .map((row) => parseAsset(row))
        .filter((row): row is AlpacaAsset => row != null && row.tradable && row.symbol.endsWith("/USD"));
    },
    async positions(): Promise<AlpacaPosition[]> {
      const res = await fetchImpl(paperUrl("/v2/positions"), { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = JSON.parse(text) as Record<string, unknown>[];
      return rows.map((row) => parsePosition(row)).filter((row): row is AlpacaPosition => row != null);
    },
    submit(order: PaperOrderRequest): Promise<PaperOrderResult> {
      return submitPaperOrder(order, env, fetchImpl);
    },
  };
}
