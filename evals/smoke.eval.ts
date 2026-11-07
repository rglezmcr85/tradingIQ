import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "The paper book is readable and the live order tool is not used.",
  async test(t) {
    await t.send("Show the paper account cash, positions, and P&L. Do not place a live order.");
    t.succeeded();
    t.calledTool("paper_book");
    t.notCalledTool("place_live_order");
  },
});