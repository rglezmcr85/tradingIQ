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

function actionClass(action) {
  if (action === "buy" || action === "sell" || action === "add") return action;
  return "";
}

function orderLabel(recommendation) {
  const order = recommendation.order;
  if (!order) return "Not sized";
  if (order.notional != null) return `${order.side} $${order.notional}`;
  return `${order.side} ${order.qty}`;
}

function ideaTable(rows) {
  if (!rows.length) return `<p class="muted">None.</p>`;
  const body = rows
    .map((row) => {
      const active = row.id === selected ? "active" : "";
      const confirm = row.confirmable && row.status === "recommendation"
        ? `<button class="confirm" type="button" data-confirm="${esc(row.id)}">Confirm this order</button>`
        : `<span class="muted">${esc(row.status === "confirmed" ? "Confirmed" : row.status === "rejected" ? "Not accepted" : "Not confirmable")}</span>`;
      return `<tr class="${active}" data-id="${esc(row.id)}">
        <td><strong>${esc(row.symbol)}</strong><div class="muted">${esc(row.assetClass)}</div></td>
        <td class="${actionClass(row.action)}">${esc(row.action)}</td>
        <td>${esc(orderLabel(row))}</td>
        <td>${confirm}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr><th>Name</th><th>Idea</th><th>Order</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function render() {
  const desk = state?.desk ?? null;
  const lede = document.querySelector("#lede");
  if (lede) {
    lede.textContent = desk?.configured
      ? "Scan portfolio checks names you hold and scans the market for new stock and crypto buys. Confirm sends only that one paper order, inside the $15,000 sleeve."
      : "Scan portfolio is manual. Alpaca paper keys are required to load the account and the market scan. No order is sent by the scan.";
  }
  badge.textContent = "Robinhood blocked";
  const items = [
    ["Sleeve cap", `$${num(desk?.cap ?? 15000, 0)}`],
    ["Sleeve cash", `$${num(desk?.sleeveCash ?? 15000)}`],
    ["Sleeve used", `$${num(desk?.buyingPowerUsed ?? 0)}`],
    ["Alpaca equity", desk?.alpacaEquity == null ? "—" : `$${num(desk.alpacaEquity)}`],
    ["Ideas", String(desk?.recommendations?.length ?? 0)],
  ];
  statsEl.innerHTML = items
    .map(([label, value]) => `<div class="card"><div class="label">${esc(label)}</div><div class="stat">${esc(value)}</div></div>`)
    .join("");

  const recommendations = desk?.recommendations ?? [];
  const ownedRows = recommendations.filter((row) => (row.scope ? row.scope === "owned" : row.action !== "buy"));
  const newRows = recommendations.filter((row) => (row.scope ? row.scope === "new" : row.action === "buy"));
  if (!selected && recommendations[0]) selected = recommendations[0].id;
  const blocker = desk?.blocker ? `<p>${esc(desk.blocker)}</p>` : "";
  const unset = desk?.unset?.length ? `<p>Unset: ${esc(desk.unset.join(", "))}</p>` : "";
  const market = desk?.market;
  const marketLine = market
    ? `<p class="muted">Market scan reviewed ${esc(market.stocksReviewed)} new stocks and ${esc(market.cryptoReviewed)} crypto pairs. New buys: ${esc(market.newStockBuys)} stocks, ${esc(market.newCryptoBuys)} crypto. No order is sent.</p>${market.modelNote ? `<p class="muted">${esc(market.modelNote)}</p>` : ""}${market.note ? `<p class="sell">${esc(market.note)}</p>` : ""}`
    : recommendations.length
      ? ""
      : `<p class="muted">No recommendations yet. Scan portfolio does not send an order.</p>`;
  tableEl.innerHTML = `${blocker}${unset}${marketLine}
    <p class="kicker">Held names</p>
    <p class="muted">Sell or add on names already in the paper account. Hold is not listed.</p>
    ${ideaTable(ownedRows)}
    <p class="kicker">New names</p>
    <p class="muted">Buy ideas from the market scan, stocks and crypto, that he does not already hold.</p>
    ${ideaTable(newRows)}`;
  for (const tr of tableEl.querySelectorAll("tr[data-id]")) {
    tr.addEventListener("click", () => {
      selected = tr.dataset.id;
      render();
    });
  }
  for (const confirmButton of tableEl.querySelectorAll("button[data-confirm]")) {
    confirmButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      confirmButton.disabled = true;
      confirmButton.textContent = "Sending";
      try {
        await load("/api/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: confirmButton.dataset.confirm }),
        });
      } catch (err) {
        detailEl.innerHTML = `<p class="sell">${esc(err.message)}</p>`;
      }
    });
  }

  const chosen = recommendations.find((row) => row.id === selected);
  if (!chosen) {
    detailEl.innerHTML = `<p class="muted">Select a recommendation. The reason has to include technicals and fundamentals. Unconfirmed ideas are not orders.</p>`;
  } else {
    detailEl.innerHTML = `
      <div class="kicker">${esc(chosen.status)}</div>
      <h2>${esc(chosen.symbol)} <span class="${actionClass(chosen.action)}">${esc(chosen.action)}</span></h2>
      <p>${esc(chosen.reason)}</p>
      ${chosen.blocker ? `<p class="sell">${esc(chosen.blocker)}</p>` : ""}
    `;
  }

  const portfolio = desk?.portfolio ?? [];
  const lines = portfolio.length
    ? portfolio
        .map(
          (position) =>
            `<tr><td>${esc(position.symbol)}</td><td>${esc(position.assetClass)}</td><td>${esc(position.qty)}</td><td>${num(position.marketValue)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No Alpaca paper portfolio loaded.</td></tr>`;
  bookEl.innerHTML = `
    <p class="muted">Alpaca equity is the full paper account. Orders from this desk can use at most $${num(desk?.cap ?? 15000, 0)} of buying power. That sleeve is tracked separately.</p>
    <table>
      <thead><tr><th>Portfolio</th><th>Class</th><th>Qty</th><th>Market value</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
  `;
  footerEl.textContent = desk?.blocker
    ? desk.blocker
    : "Technicals are Yahoo daily bars, not a tick stream. Stock fundamentals are SEC company facts. Crypto fundamentals are CoinGecko market cap. Crypto is on. Live Robinhood orders are not sent. Alpaca live trading is not used.";
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
    button.textContent = "Scan portfolio";
  }
});

load("/api/state").catch((err) => {
  detailEl.textContent = err.message;
});
