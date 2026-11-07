# MyTradingIQ

Paper trading desk for Ricardo Gonzalez. It scans US-listed common stocks, then runs technicals and SEC fundamentals only on the names that pass. A rule in code sets buy, hold, or sell. The paper book applies that decision with a size cap.

Live Robinhood orders stay blocked. The Trading MCP connection is ready for browser OAuth later. Do not paste a token into the repo.

## Run

```bash
npm install
npm run selfcheck
npm run week
npm run dashboard
```

Open the dashboard with `npm run dashboard` at http://127.0.0.1:4173. Press **Scan portfolio**. That loads the Alpaca paper account and lists recommendations. Press **Confirm this order** on one row to send that order only. The scan does not send an order. The clock does not send an order.

## Desk

Market scan, technical analyst, fundamental analyst, bull and bear note, trader decision, then the paper book. The thresholds live in `bot/lib/rules.ts` and `bot/lib/decision.ts`.

## Data

- Universe: Nasdaq Trader symbol directories (Nasdaq and other US exchanges), excluding ETFs and test issues.
- Rank: Nasdaq stock screener snapshot (last sale, volume, market cap). That quote is for ranking only.
- Technicals: Yahoo Finance daily chart, one year. SMA20, SMA50, and RSI(14) are computed from those closes.
- Fundamentals: SEC EDGAR company facts. No API key. Missing filings stay null.

## Paper and live

Confirmed orders use Alpaca paper only, inside a $15,000 sleeve tracked separately from the full paper equity. Crypto is on. A name is skipped when one unit costs more than the remaining sleeve cash. Fractional size is used only when that Alpaca paper asset says it is fractionable. `ALPACA_PAPER_TRADE` stays at its default true.

Robinhood: `https://agent.robinhood.com/mcp/trading` (Streamable HTTP, OAuth 2.1 PKCE, public client). After you want the live path, run `npx @grok/agent-sdk mcp oauth robinhood` and approve it in the browser. Orders stay off until that connection exists and `MYTRADINGIQ_LIVE_ORDERS=confirm`. This build does not submit an order. Reads can span accounts. Any later order stays on the Agentic account and is a long equity or a long option.
