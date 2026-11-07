import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { liveGate } from "../lib/live-gate";
import { loadBook, markBook } from "../lib/paper";
import { readLastScan } from "../lib/pipeline";

export default defineTool({
  description: "Read the paper account: cash, positions, fills, and P&L. Does not place a live order.",
  effect: "read",
  inputSchema: z.object({}),
  async execute() {
    const book = markBook(await loadBook());
    const scan = await readLastScan();
    return {
      paper: book,
      lastScanAt: scan?.generatedAt ?? null,
      analyzed: scan?.universe.analyzed ?? [],
      live: liveGate(),
    };
  },
});
