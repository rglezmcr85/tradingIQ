import { defineConnection } from "@grok/agent-sdk/connections";

/**
 * Official Robinhood Trading MCP. Host-only so the model cannot call order
 * tools directly. Authorize with `npx @grok/agent-sdk mcp oauth robinhood`.
 * Tokens stay in the CLI config. Do not put a token in the repo.
 */
export default defineConnection({
  url: "https://agent.robinhood.com/mcp/trading",
  oauth: true,
  description:
    "Robinhood Trading MCP (Streamable HTTP, OAuth 2.1 PKCE public client). Reads can span accounts. Order tools stay off the model.",
});
