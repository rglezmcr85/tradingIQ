import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { reviewLiveOrder } from "../lib/live-gate";

const inputSchema = z.object({
  symbol: z.string().min(1).max(12),
  asset: z.enum(["equity", "option"]),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  orderType: z.enum(["market", "limit"]),
  limitPrice: z.number().positive().optional(),
  optionRight: z.enum(["call", "put"]).optional(),
});

const blocked = {
  placed: false,
  submission: "blocked",
  reason: "Dry run does not submit a Robinhood order.",
};

export default defineTool({
  description:
    "Live Robinhood order path. Stays blocked until OAuth is connected and MYTRADINGIQ_LIVE_ORDERS=confirm. This tool does not submit an order.",
  effect: "write",
  inputSchema,
  dryRunResult: blocked,
  async execute(input) {
    const review = reviewLiveOrder({
      symbol: input.symbol.toUpperCase(),
      asset: input.asset,
      side: input.side,
      quantity: input.quantity,
      orderType: input.orderType,
      limitPrice: input.limitPrice,
      optionRight: input.optionRight,
    });
    return {
      placed: false,
      submission: "blocked",
      confirmFlag: review.confirmFlag,
      oauthConnected: false,
      endpoint: review.endpoint,
      blockers: review.blockers,
      accountScope: review.accountScope,
    };
  },
});
