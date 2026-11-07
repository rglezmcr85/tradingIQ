/** Live Robinhood orders stay off unless both gates are true. This build still does not submit. */

export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const LIVE_CONFIRM_VALUE = "confirm";

export type LiveGate = {
  broker: "Robinhood Trading MCP";
  endpoint: string;
  transport: "streamable-http";
  auth: "oauth2.1-pkce-public-client";
  confirmFlag: boolean;
  oauthConnected: false;
  submission: "blocked";
  placed: false;
  accountScope: "Reads can span accounts after OAuth. Orders stay on the Agentic account, long equities and long options only.";
  reason: string;
};

export function liveGate(env: NodeJS.ProcessEnv = process.env): LiveGate {
  const confirmFlag = env.MYTRADINGIQ_LIVE_ORDERS === LIVE_CONFIRM_VALUE;
  const reason = confirmFlag
    ? "MYTRADINGIQ_LIVE_ORDERS=confirm is set, but this process has not completed Robinhood OAuth and does not submit orders."
    : "Live orders are disabled. Connect OAuth in the browser, then set MYTRADINGIQ_LIVE_ORDERS=confirm. Do not paste a token.";
  return {
    broker: "Robinhood Trading MCP",
    endpoint: ROBINHOOD_MCP_URL,
    transport: "streamable-http",
    auth: "oauth2.1-pkce-public-client",
    confirmFlag,
    oauthConnected: false,
    submission: "blocked",
    placed: false,
    accountScope:
      "Reads can span accounts after OAuth. Orders stay on the Agentic account, long equities and long options only.",
    reason,
  };
}

export type LiveOrderRequest = {
  symbol: string;
  asset: "equity" | "option";
  side: "buy" | "sell";
  quantity: number;
  orderType: "market" | "limit";
  limitPrice?: number;
  optionRight?: "call" | "put";
};

export function reviewLiveOrder(request: LiveOrderRequest, env: NodeJS.ProcessEnv = process.env): LiveGate & {
  acceptedShape: boolean;
  blockers: string[];
} {
  const gate = liveGate(env);
  const blockers: string[] = [gate.reason];
  if (request.side === "sell") {
    blockers.push("Sell is out of scope while live orders are blocked. This path does not open shorts.");
  }
  if (request.asset === "option" && request.optionRight == null) {
    blockers.push("A long option needs call or put. Nothing was sent.");
  }
  if (request.orderType === "limit" && (request.limitPrice == null || request.limitPrice <= 0)) {
    blockers.push("A limit order needs a positive limit price. Nothing was sent.");
  }
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(request.symbol.toUpperCase())) {
    blockers.push("Symbol is not a listed-equity shape.");
  }
  return { ...gate, acceptedShape: blockers.length === 1 && request.side === "buy", blockers };
}
