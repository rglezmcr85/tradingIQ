import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "MyTradingIQ",
  description: "Scan on request, recommend with technicals and fundamentals, and send one confirmed order to Alpaca paper. Live and Robinhood orders stay blocked.",
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
      "paper-api.alpaca.markets",
      "api.coingecko.com",
    ],
  },
});
