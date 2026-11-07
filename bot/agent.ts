import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "MyTradingIQ",
  description: "Scan the US market, analyze the names that surface, and apply paper decisions. Live orders stay blocked.",
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    egressDomains: [
      "api.nasdaq.com",
      "www.nasdaqtrader.com",
      "query1.finance.yahoo.com",
      "www.sec.gov",
      "data.sec.gov",
      "agent.robinhood.com",
      "robinhood.com",
      "api.robinhood.com",
    ],
  },
});
