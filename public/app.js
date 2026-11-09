const statsEl = document.querySelector("#stats");
const ideasEl = document.querySelector("#ideas");
const bookEl = document.querySelector("#book");
const footerEl = document.querySelector("#footer");
const button = document.querySelector("#scan-button");
const badge = document.querySelector("#live-badge");

let state = null;

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

function ideaCard(row) {
  const math = row.math || { action: row.action, reason: row.reason };
  const ai = row.ai;
  const confirm = row.confirmable && row.status === "recommendation" && row.order
    ? `<button class="confirm" type="button" data-confirm="${esc(row.id)}">Confirm this order</button>`
    : `<span class="muted">${esc(row.status === "confirmed" ? "Confirmed" : row.status === "rejected" ? "Not accepted" : row.order ? "Not confirmable" : "No order")}</span>`;
  const aiHtml = ai
    ? `<div class="${actionClass(ai.action)}">${esc(ai.action)}</div><p>${esc(ai.reason)}</p>`
    : `<p class="muted">AI read did not run.</p>`;
  return `<article class="card idea">
    <div class="idea-head">
      <div>
        <strong>${esc(row.symbol)}</strong>
        <div class="muted">${esc(row.name || row.symbol)} · ${esc(row.assetClass)}</div>
      </div>
      <div>${esc(orderLabel(row))}</div>
    </div>
    <div class="reads">
      <section class="read">
        <div class="kicker">Mathematical</div>
        <div class="${actionClass(math.action)}">${esc(math.action)}</div>
        <p>${esc(math.reason)}</p>
      </section>
      <section class="read">
        <div class="kicker">AI</div>
        ${aiHtml}
      </section>
    </div>
    ${row.blocker ? `<p class="sell">${esc(row.blocker)}</p>` : ""}
    <p>${confirm}</p>
  </article>`;
}

function ideaGroup(title, note, rows) {
  const body = rows.length ? rows.map(ideaCard).join("") : `<p class="muted">None.</p>`;
  return `<h2 class="group-title">${esc(title)}</h2><p class="muted">${esc(note)}</p>${body}`;
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
    ["Sleeve room", `$${num(desk?.market?.sleeveRoom ?? desk?.cap ?? 15000, 0)}`],
    ["Alpaca equity", desk?.alpacaEquity == null ? "—" : `$${num(desk.alpacaEquity)}`],
    ["Ideas", String(desk?.recommendations?.length ?? 0)],
  ];
  statsEl.innerHTML = items
    .map(([label, value]) => `<div class="card"><div class="label">${esc(label)}</div><div class="stat">${esc(value)}</div></div>`)
    .join("");

  const recommendations = desk?.recommendations ?? [];
  const heldRows = recommendations.filter((row) => row.scope === "owned" || (row.scope == null && row.action !== "buy"));
  const stockRows = recommendations.filter((row) => row.assetClass !== "crypto" && (row.scope === "new" || (row.scope == null && row.action === "buy")));
  const cryptoRows = recommendations.filter((row) => row.assetClass === "crypto" && row.scope !== "owned");
  const blocker = desk?.blocker ? `<p>${esc(desk.blocker)}</p>` : "";
  const unset = desk?.unset?.length ? `<p>Unset: ${esc(desk.unset.join(", "))}</p>` : "";
  const market = desk?.market;
  const roomLine = market
    ? `<p class="muted">Sleeve cap $${num(desk?.cap ?? 15000, 0)}. Paper positions $${num(market.positionMarketValue ?? 0, 0)}. Unconfirmed buys kept from earlier scans $${num(market.reservedNotional ?? 0, 0)}. Room left $${num(market.sleeveRoom ?? 0, 0)}. No order is sent until you confirm that one.</p>`
    : "";
  const marketLine = market
    ? `<p class="muted">Reviewed ${esc(market.stocksReviewed)} new stocks and ${esc(market.cryptoReviewed)} crypto pairs. Stock buys ${esc(market.newStockBuys)}. Crypto ideas ${esc(market.newCryptoBuys)}.</p>${market.modelNote ? `<p class="muted">${esc(market.modelNote)}</p>` : ""}${market.note ? `<p class="sell">${esc(market.note)}</p>` : ""}`
    : recommendations.length
      ? ""
      : `<p class="muted">No recommendations yet. Scan portfolio does not send an order.</p>`;
  ideasEl.innerHTML = `${blocker}${unset}${roomLine}${marketLine}
    ${ideaGroup("Held names", "Mathematical and AI reads on names already in the paper account.", heldRows)}
    ${ideaGroup("New stocks", "Buy ideas that he does not already hold. A rescan keeps unconfirmed orders.", stockRows)}
    ${ideaGroup("Crypto", "Alpaca USD pairs. Both reads are on the card.", cryptoRows)}`;
  for (const confirmButton of ideasEl.querySelectorAll("button[data-confirm]")) {
    confirmButton.addEventListener("click", async () => {
      confirmButton.disabled = true;
      confirmButton.textContent = "Sending";
      try {
        await load("/api/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: confirmButton.dataset.confirm }),
        });
      } catch (err) {
        confirmButton.textContent = err.message;
      }
    });
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
    ideasEl.innerHTML = `<p class="sell">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Scan portfolio";
  }
});

load("/api/state").catch((err) => {
  ideasEl.textContent = err.message;
});
