import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { liveGate } from "../lib/live-gate";

export default defineTool({
  description:
    "Report whether the Robinhood live path is connected. Does not read an account and does not place an order.",
  effect: "read",
  inputSchema: z.object({}),
  async execute() {
    return liveGate();
  },
});
