import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runScan } from "../lib/pipeline";
import { RULES } from "../lib/rules";

export default defineTool({
  description:
    "Scan the US listed market, then run technicals, SEC fundamentals, research, and paper decisions on the names that pass. No fixed watchlist.",
  effect: "write",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(RULES.deepAnalysisMax).optional(),
  }),
  dryRunResult: {
    ok: false,
    error: "Dry run does not scan the market or change the paper book.",
  },
  async execute(input) {
    try {
      return await runScan(input.limit ?? RULES.deepAnalysisDefault);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "scan failed" };
    }
  },
});
