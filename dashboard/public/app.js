const statsEl = document.querySelector("#stats");
const tableEl = document.querySelector("#scan-table");
const detailEl = document.querySelector("#detail");
const bookEl = document.querySelector("#book");
const footerEl = document.querySelector("#footer");
const button = document.querySelector("#scan-button");
const badge = document.querySelector("#live-badge");

let state = null;
let selected = null;

function esc(value) {
  return String(value ?? "—")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function num(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function compact(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

function pct(value) {
  if (value == null) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function actionClass(action) {
  if (action === "buy" || action === "sell" || action === "hold") return action;
  return "";
}

function spark(closes) {
  if (!closes || closes.length < 2) return "";
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = closes
    .map((close, index) => {
      const x = (index / (closes.length - 1)) * 140;
      const y = 40 - ((close - min) / span) * 36;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 140 42"><polyline fill="none" stroke="#1c1915" stroke-width="2" points="${points}" /></svg>`;
}

function renderStats(scan) {
  if (!scan) {
    statsEl.innerHTML = `<div class="card"><div class="label">Universe</div><div class="stat">No scan yet</div></div>`;
    return;
  }
  const u = scan.universe;
  const items = [
    ["Listed names", u.listedCommonStocks.toLocaleString("en-US")],
    ["Screener rows", u.screenerRows.toLocaleString("en-US")],
    ["Passed screen", u.passedScreen.toLocaleString("en-US")],
    ["Analyzed", String(u.analyzed.length)],
    ["Paper equity", `$${num(state.paper.equity)}`],
  ];
  statsEl.innerHTML = items
    .map(([label, value]) => `<div class="card"><div class="label">${esc(label)}</div><div class="stat">${esc(value)}</div></div>`)
    .join("");
}

function renderTable(scan) {
  if (!scan) {
    tableEl.innerHTML = `<p class="muted">Run a scan to pull prices and filings. Nothing is filled in ahead of time.</p>`;
    return;
  }
  const rows = scan.analyses
    .map((row) => {
      const active = row.symbol === selected ? "active" : "";
      return `<tr class="${active}" data-symbol="${esc(row.symbol)}">
        <td><strong>${esc(row.symbol)}</strong><div class="muted">${esc(row.name)}</div></td>
        <td class="${actionClass(row.decision.action)}">${esc(row.decision.action)}</td>
        <td>${esc(row.decision.bias)}</td>
        <td>${num(row.technical.lastClose)}</td>
        <td>${num(row.technical.rsi14, 1)}</td>
        <td>${num(row.fundamental.trailingPe, 1)}</td>
        <td>${esc(row.book.bookAction)}</td>
      </tr>`;
    })
    .join("");
  tableEl.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Action</th><th>Bias</th><th>Close</th><th>RSI</th><th>P/E</th><th>Book</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  for (const tr of tableEl.querySelectorAll("tr[data-symbol]")) {
    tr.addEventListener("click", () => {
      selected = tr.dataset.symbol;
      render();
    });
  }
}

function renderDetail(scan) {
  const row = scan?.analyses.find((item) => item.symbol === selected);
  if (!row) {
    detailEl.innerHTML = `<p class="muted">Select a symbol.</p>`;
    return;
  }
  const t = row.technical;
  const f = row.fundamental;
  const why = row.decision.why.map((line) => `<li>${esc(line)}</li>`).join("");
  const bull = row.research.bullCase.map((line) => `<li>${esc(line)}</li>`).join("") || "<li>None from the pulled facts.</li>";
  const bear = row.research.bearCase.map((line) => `<li>${esc(line)}</li>`).join("") || "<li>None from the pulled facts.</li>";
  detailEl.innerHTML = `
    <div class="kicker">${esc(row.origin)}</div>
    <h2>${esc(row.symbol)} <span class="${actionClass(row.decision.action)}">${esc(row.decision.action)}</span></h2>
    <p>${esc(row.name)} · bias ${esc(row.decision.bias)} · research ${esc(row.research.stance)}</p>
    ${spark(t.closes)}
    <div class="grid2">
      <div>
        <div class="label">Technicals · Yahoo daily</div>
        <p>Close ${num(t.lastClose)} on ${esc(t.asOf)} · ${t.barCount} bars</p>
        <p>SMA20 ${num(t.sma20)} · SMA50 ${num(t.sma50)} · RSI14 ${num(t.rsi14, 1)}</p>
        <p>Trend ${esc(t.trend)} · screen quote ${num(row.screenLastSale)} used only to rank</p>
      </div>
      <div>
        <div class="label">Fundamentals · ${esc(f.source)}</div>
        ${
          f.status === "ok"
            ? `<p>${esc(f.companyName)} · CIK ${esc(f.cik)}</p>
        <p>Year ending ${esc(f.periodEnd)} · revenue ${compact(f.revenue)} · growth ${pct(f.revenueGrowth)}</p>
        <p>Net income ${compact(f.netIncome)} · EPS ${num(f.dilutedEps)} · P/E ${num(f.trailingPe, 1)} · margin ${pct(f.netMargin)}</p>
        <p class="muted">Accession ${esc(f.accession)} · filed ${esc(f.filed)}</p>`
            : `<p>${esc(f.unavailableReason || "SEC company facts were not available. No figure was filled in.")}</p>`
        }
      </div>
    </div>
    <div class="grid2">
      <div><div class="label">Bull case</div><ul class="notes">${bull}</ul></div>
      <div><div class="label">Bear case</div><ul class="notes">${bear}</ul></div>
    </div>
    <div class="label">Why</div>
    <ul class="notes">${why}</ul>
    <p><strong>Paper:</strong> ${esc(row.book.bookWhy)}</p>
  `;
}

function renderBook(paper) {
  const positions = paper.positions.length
    ? paper.positions
        .map(
          (position) =>
            `<tr><td>${esc(position.symbol)}</td><td>${esc(position.shares)}</td><td>${num(position.avgCost)}</td><td>${num(position.markPrice)}</td><td>${num(position.unrealizedPnl)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No open paper positions.</td></tr>`;
  const trades = paper.trades.length
    ? paper.trades
        .slice(-8)
        .reverse()
        .map(
          (trade) =>
            `<tr><td>${esc(trade.filledAt?.slice(0, 16))}</td><td>${esc(trade.side)}</td><td>${esc(trade.symbol)}</td><td>${esc(trade.shares)}</td><td>${num(trade.fillPrice)}</td><td>${num(trade.realizedPnl)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="6">No paper fills yet.</td></tr>`;
  bookEl.innerHTML = `
    <div class="stats">
      <div><div class="label">Cash</div><div class="stat">$${num(paper.cash)}</div></div>
      <div><div class="label">Equity</div><div class="stat">$${num(paper.equity)}</div></div>
      <div><div class="label">Unrealized</div><div class="stat">$${num(paper.unrealizedPnl)}</div></div>
      <div><div class="label">Realized</div><div class="stat">$${num(paper.realizedPnl)}</div></div>
      <div><div class="label">Total P&L</div><div class="stat">$${num(paper.totalPnl)}</div></div>
    </div>
    <table>
      <thead><tr><th>Position</th><th>Shares</th><th>Avg cost</th><th>Mark</th><th>Unrealized</th></tr></thead>
      <tbody>${positions}</tbody>
    </table>
    <h2>Recent fills</h2>
    <table>
      <thead><tr><th>When</th><th>Side</th><th>Symbol</th><th>Shares</th><th>Fill</th><th>Realized</th></tr></thead>
      <tbody>${trades}</tbody>
    </table>
  `;
}

function render() {
  const scan = state?.scan ?? null;
  if (scan && !selected) selected = scan.analyses[0]?.symbol ?? null;
  const lede = document.querySelector("#lede");
  const week = state?.week;
  if (lede) {
    lede.textContent = week?.active
      ? `$50 paper week through ${week.week.endsAt.slice(0, 16)} UTC. Scan daily at 21:30 UTC. Live orders stay blocked.`
      : "US-listed scan for a $50 paper book. One whole share only when the price fits in the remaining cash.";
  }
  badge.textContent = state?.live?.submission === "blocked" ? "Live orders blocked" : "Live path";
  renderStats(scan);
  renderTable(scan);
  renderDetail(scan);
  renderBook(state.paper);
  const u = scan?.universe;
  footerEl.textContent = u
    ? `Universe: Nasdaq Trader symbol directories, ${u.listedCommonStocks.toLocaleString("en-US")} common stocks after ETF and test-issue filters. Nasdaq screener returned ${u.screenerRows.toLocaleString("en-US")} rows; ${u.passedScreen.toLocaleString("en-US")} passed price, volume, and market-cap filters. ${Number(u.affordableNames ?? 0).toLocaleString("en-US")} of those have a screen price at or under $${Number(u.priceCeiling ?? 50)}. Deep analysis: ${u.analyzed.join(", ") || "none"}. A buy is one whole share when it fits in remaining cash. Prices: Yahoo daily chart. Fundamentals: SEC EDGAR company facts.`
    : "No scan file yet. The desk does not ship a watchlist.";
}

async function load(path, options) {
  const res = await fetch(path, options);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  state = body;
  render();
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Scanning";
  try {
    await load("/api/scan", { method: "POST" });
  } catch (err) {
    detailEl.innerHTML = `<p class="sell">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Run scan";
  }
});

load("/api/state").catch((err) => {
  detailEl.textContent = err.message;
});
