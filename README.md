# MyTradingIQ

Paper trading desk for Ricardo Gonzalez. It scans US-listed common stocks, then runs technicals and SEC fundamentals only on the names that pass. A rule in code sets buy, hold, or sell. The paper book applies that decision with a size cap.

Live Robinhood orders stay blocked. The Trading MCP connection is ready for browser OAuth later. Do not paste a token into the repo.

## Run

```bash
npm install
npm run selfcheck
npm run scan
npm run dashboard
```

Open http://127.0.0.1:4173

## Desk

Market scan, technical analyst, fundamental analyst, bull and bear note, trader decision, then the paper book. The thresholds live in `bot/lib/rules.ts` and `bot/lib/decision.ts`.

## Data

- Universe: Nasdaq Trader symbol directories (Nasdaq and other US exchanges), excluding ETFs and test issues.
- Rank: Nasdaq stock screener snapshot (last sale, volume, market cap). That quote is for ranking only.
- Technicals: Yahoo Finance daily chart, one year. SMA20, SMA50, and RSI(14) are computed from those closes.
- Fundamentals: SEC EDGAR company facts. No API key. Missing filings stay null.

## Paper and live

The paper account starts at $10,000. A new long is at most 10% of equity, five names maximum, whole shares, filled at the last daily close.

Robinhood: `https://agent.robinhood.com/mcp/trading` (Streamable HTTP, OAuth 2.1 PKCE, public client). After you want the live path, run `npx @grok/agent-sdk mcp oauth robinhood` and approve it in the browser. Orders stay off until that connection exists and `MYTRADINGIQ_LIVE_ORDERS=confirm`. This build does not submit an order. Reads can span accounts. Any later order stays on the Agentic account and is a long equity or a long option.
