/* ETF Basket Analysis frontend. No build step, no framework, no CDN. */

(function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
})();
document.getElementById("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
});

const SECTOR_ORDER = [
  "technology", "financial_services", "healthcare", "consumer_cyclical",
  "industrials", "communication_services", "consumer_defensive", "energy",
];
const SECTOR_LABELS = {
  technology: "Technology", financial_services: "Financial Services",
  healthcare: "Healthcare", consumer_cyclical: "Consumer Cyclical",
  industrials: "Industrials", communication_services: "Communication Services",
  consumer_defensive: "Consumer Defensive", energy: "Energy",
  utilities: "Utilities", real_estate: "Real Estate", realestate: "Real Estate",
  basic_materials: "Basic Materials",
};
const SECTOR_COLORS = ["--series-1","--series-2","--series-3","--series-4","--series-5","--series-6","--series-7","--series-8"];

let ETFS = [];
let MARKET = {};
let NEWS = {};
let NEWS_HAS_KEY = false;
let MANAGER_PROFILES = {};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmtMoney(v, currency) {
  if (v === null || v === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch { return `${v.toFixed(2)} ${currency}`; }
}
function fmtPct(v, opts = {}) {
  if (v === null || v === undefined) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(opts.decimals ?? 2)}%`;
}
function fmtBig(v) {
  if (v === null || v === undefined) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v}`;
}
function ageFromDate(iso) {
  const then = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - then.getFullYear();
  const m = now.getMonth() - then.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < then.getDate())) years--;
  return years;
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diffMs / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function loadData() {
  const [etfs, market, news, profiles] = await Promise.all([
    fetch("etfs.json").then(r => r.json()),
    fetch("data/market_data.json").then(r => r.json()),
    fetch("data/news.json").then(r => r.json()).catch(() => ({ news: {}, has_key: false })),
    fetch("manager_profiles.json").then(r => r.json()).catch(() => ({})),
  ]);
  ETFS = etfs;
  MARKET = market.etfs || {};
  NEWS = news.news || {};
  NEWS_HAS_KEY = !!news.has_key;
  MANAGER_PROFILES = profiles || {};

  document.getElementById("meta-line").innerHTML =
    `Updated <strong>${new Date(market.generated_at).toLocaleString()}</strong><br>20 ETFs tracked &middot; auto-refreshed on a schedule`;
}

function renderStatRow() {
  const rows = ETFS.map(e => ({ ...e, m: MARKET[e.ticker] || {} }))
    .filter(r => r.m.change_1d_pct !== null && r.m.change_1d_pct !== undefined && r.m.change_1y_pct !== null && r.m.change_1y_pct !== undefined);

  const byDay = [...rows].sort((a, b) => b.m.change_1d_pct - a.m.change_1d_pct);
  const byYear = [...rows].sort((a, b) => b.m.change_1y_pct - a.m.change_1y_pct);
  const strongestDay = byDay[0], weakestDay = byDay[byDay.length - 1];
  const strongestYear = byYear[0], weakestYear = byYear[byYear.length - 1];

  const tile = (label, r, key) => {
    const v = r.m[key];
    const cls = v >= 0 ? "delta-up" : "delta-down";
    const arrow = v >= 0 ? "▲" : "▼";
    return `<div class="stat-tile">
      <div class="label">${label}</div>
      <div class="value">${r.ticker}</div>
      <div class="sub ${cls}">${arrow} ${fmtPct(v)}</div>
    </div>`;
  };

  document.getElementById("stat-row").innerHTML =
    tile("Strongest today (1D)", strongestDay, "change_1d_pct") +
    tile("Weakest today (1D)", weakestDay, "change_1d_pct") +
    tile("Best 1-year performer", strongestYear, "change_1y_pct") +
    tile("Worst 1-year performer", weakestYear, "change_1y_pct");
}

function renderPerfChart() {
  const rows = ETFS.map(e => ({ ...e, m: MARKET[e.ticker] || {} }))
    .filter(r => r.m.change_1y_pct !== null && r.m.change_1y_pct !== undefined)
    .sort((a, b) => b.m.change_1y_pct - a.m.change_1y_pct);

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.m.change_1y_pct)), 1);

  const chart = document.getElementById("perf-chart");
  chart.innerHTML = rows.map(r => {
    const v = r.m.change_1y_pct;
    const pct = (Math.abs(v) / maxAbs) * 50; // half-width from center baseline
    const cls = v >= 0 ? "up" : "down";
    const style = v >= 0 ? `width:${pct}%;` : `width:${pct}%;`;
    return `<div class="bar-row">
      <div class="tk">${r.ticker}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="${style}"></div></div>
      <div class="val ${v >= 0 ? "delta-up" : "delta-down"}">${fmtPct(v, { decimals: 1 })}</div>
    </div>`;
  }).join("");

  document.getElementById("perf-table-body").innerHTML = rows.map(r => `
    <tr>
      <td>${r.ticker}</td>
      <td>${r.name}</td>
      <td class="num ${r.m.change_1d_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_1d_pct)}</td>
      <td class="num ${r.m.change_1y_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_1y_pct)}</td>
      <td class="num ${r.m.change_ytd_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_ytd_pct)}</td>
    </tr>`).join("");
}

function drawSparkline(canvas, history, positive) {
  if (!history || history.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const closes = history.map(p => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = (max - min) || 1;
  const stepX = w / (closes.length - 1);
  ctx.beginPath();
  closes.forEach((c, i) => {
    const x = i * stepX;
    const y = h - ((c - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = positive ? cssVar("--good-status") : cssVar("--critical");
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  // end dot
  const lastY = h - ((closes[closes.length - 1] - min) / range) * (h - 4) - 2;
  ctx.beginPath();
  ctx.arc(w - 1, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = positive ? cssVar("--good-status") : cssVar("--critical");
  ctx.fill();
}

function renderGrid() {
  const grid = document.getElementById("etf-grid");
  grid.innerHTML = "";
  ETFS.forEach(etf => {
    const m = MARKET[etf.ticker] || {};
    const positive = (m.change_1y_pct ?? 0) >= 0;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="ticker">${etf.ticker}</div>
          <div class="name">${etf.name}</div>
        </div>
        <div class="currency-badge">${m.currency || etf.currency}</div>
      </div>
      <div class="card-price-row">
        <div class="card-price">${fmtMoney(m.price, m.currency || etf.currency)}</div>
        <div class="card-change ${(m.change_1d_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1d_pct)}</div>
      </div>
      <div class="card-1y">1Y: <span class="${positive ? "delta-up" : "delta-down"}">${fmtPct(m.change_1y_pct)}</span></div>
      <canvas class="spark"></canvas>
    `;
    card.addEventListener("mouseenter", (ev) => showHoverTip(ev, etf, m));
    card.addEventListener("mousemove", positionHoverTip);
    card.addEventListener("mouseleave", hideHoverTip);
    card.addEventListener("click", () => openModal(etf, m));
    grid.appendChild(card);
    requestAnimationFrame(() => drawSparkline(card.querySelector("canvas"), m.history, positive));
  });
}

const hoverTip = document.getElementById("hover-tip");
function showHoverTip(ev, etf, m) {
  const age = ageFromDate(etf.inception_date);
  hoverTip.innerHTML = `
    <div class="h-title">${etf.ticker} &middot; ${etf.manager}</div>
    <div class="h-row"><span>Category</span><span>${etf.category}</span></div>
    <div class="h-row"><span>Inception</span><span>${fmtDate(etf.inception_date)}</span></div>
    <div class="h-row"><span>Fund age</span><span>${age} years</span></div>
    <div class="h-row"><span>Expense ratio</span><span>${etf.expense_ratio}%</span></div>
    <div class="h-row"><span>1Y change</span><span class="${(m.change_1y_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1y_pct)}</span></div>
    <div class="h-row"><span>AUM</span><span>${fmtBig(m.aum)}</span></div>
  `;
  hoverTip.classList.add("show");
  positionHoverTip(ev);
}
function positionHoverTip(ev) {
  const pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + 240 > window.innerWidth) x = ev.clientX - 240 - pad;
  if (y + 200 > window.innerHeight) y = ev.clientY - 200;
  hoverTip.style.left = `${x}px`;
  hoverTip.style.top = `${y}px`;
}
function hideHoverTip() { hoverTip.classList.remove("show"); }

function renderSectorBars(sectorWeights) {
  const entries = Object.entries(sectorWeights || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return `<div class="empty-note">No equity sector breakdown available for this fund (e.g. commodity, single-asset, or bond trusts don't hold sector-classified equities).</div>`;
  }
  const top = entries.slice(0, 8);
  const other = entries.slice(8).reduce((s, [, v]) => s + v, 0);
  const rows = [...top];
  if (other > 0) rows.push(["other", other]);
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return rows.map(([key, val], i) => {
    const color = key === "other" ? "var(--series-other)" : `var(--series-${(i % 8) + 1})`;
    const label = SECTOR_LABELS[key] || (key === "other" ? "Other" : key);
    const width = (val / max) * 100;
    return `<div class="sector-bar-row">
      <div class="sname">${label}</div>
      <div class="sector-track"><div class="sector-fill" style="width:${width}%; background:${color}"></div></div>
      <div class="sval">${val.toFixed(1)}%</div>
    </div>`;
  }).join("");
}

function renderHoldingsTable(m) {
  if (!m.top_holdings || m.top_holdings.length === 0) {
    return `<div class="empty-note">No individual holdings to show &mdash; this fund tracks a single physical asset or a broad index without disclosed constituent weights via this data source.</div>`;
  }
  const strongSym = m.strongest_holding && m.strongest_holding.symbol;
  const weakSym = m.weakest_holding && m.weakest_holding.symbol;
  return `<table class="data-table">
    <thead><tr><th>Symbol</th><th>Name</th><th class="num">Weight</th><th class="num">1Y change</th></tr></thead>
    <tbody>
      ${m.top_holdings.map(h => `
        <tr>
          <td>${h.symbol}${h.symbol === strongSym ? '<span class="holding-badge strong">Strongest</span>' : ""}${h.symbol === weakSym ? '<span class="holding-badge weak">Weakest</span>' : ""}</td>
          <td>${h.name}</td>
          <td class="num">${h.weight_pct.toFixed(2)}%</td>
          <td class="num ${(h.change_1y_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(h.change_1y_pct)}</td>
        </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderNews(ticker) {
  const items = NEWS[ticker];
  if (!NEWS_HAS_KEY) {
    return `<div class="empty-note">Live news isn't wired up yet. Add a free API key from <a href="https://newsapi.org" target="_blank" rel="noopener">newsapi.org</a> as the <code>NEWSAPI_KEY</code> secret in this repo's GitHub settings, and the next scheduled refresh will populate headlines here.</div>`;
  }
  if (!items || items.length === 0) {
    return `<div class="empty-note">No recent headlines matched this ticker in the last fetch.</div>`;
  }
  return items.map(a => `
    <div class="news-item">
      <a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
      <div class="src">${a.source || "Unknown source"} &middot; ${timeAgo(a.published_at)}</div>
    </div>`).join("");
}

const modalBackdrop = document.getElementById("modal-backdrop");
const modalBody = document.getElementById("modal-body");

function openModal(etf, m) {
  const age = ageFromDate(etf.inception_date);
  modalBody.innerHTML = `
    <div class="modal-head">
      <div>
        <h2>${etf.ticker} <span style="font-weight:400; color:var(--text-secondary); font-size:15px;">${etf.name}</span></h2>
        <div class="sub">${etf.manager} &middot; ${etf.category}</div>
      </div>
      <button class="modal-close" id="modal-close">&times;</button>
    </div>

    <div class="fact-grid">
      <div class="fact"><div class="k">Price</div><div class="v">${fmtMoney(m.price, m.currency || etf.currency)}</div></div>
      <div class="fact"><div class="k">Currency</div><div class="v">${m.currency || etf.currency}</div></div>
      <div class="fact"><div class="k">1D change</div><div class="v ${(m.change_1d_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1d_pct)}</div></div>
      <div class="fact"><div class="k">1Y change</div><div class="v ${(m.change_1y_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1y_pct)}</div></div>
      <div class="fact"><div class="k">AUM</div><div class="v">${fmtBig(m.aum)}</div></div>
      <div class="fact"><div class="k">Expense ratio</div><div class="v">${etf.expense_ratio}%</div></div>
      <div class="fact"><div class="k">Inception</div><div class="v">${fmtDate(etf.inception_date)}</div></div>
      <div class="fact"><div class="k">Fund age</div><div class="v">${age} years</div></div>
      <div class="fact"><div class="k">Manager</div><div class="v">${etf.manager}</div></div>
    </div>

    <h3>What it is</h3>
    <p class="prose">${etf.description || "—"}</p>

    <h3>Who manages it</h3>
    <p class="prose">${MANAGER_PROFILES[etf.manager] || etf.manager}</p>

    <h3>Who typically holds/trades it</h3>
    <p class="prose">${etf.typical_holders || "—"}</p>

    <h3>What makes it successful</h3>
    <p class="prose">${etf.success_factors || "—"}</p>

    <h3>Political &amp; policy exposure</h3>
    <p class="prose">${etf.political_context || "—"}</p>

    <h3>Composition by sector</h3>
    ${renderSectorBars(m.sector_weights)}

    <h3>Top holdings &mdash; strongest &amp; weakest in the basket</h3>
    ${renderHoldingsTable(m)}

    <h3>News affecting ${etf.ticker} (politics, policy, macro)</h3>
    ${renderNews(etf.ticker)}
  `;
  modalBackdrop.classList.remove("hidden");
  document.getElementById("modal-close").addEventListener("click", closeModal);
}
function closeModal() { modalBackdrop.classList.add("hidden"); }
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

document.getElementById("perf-table-toggle").addEventListener("click", () => {
  const chart = document.getElementById("perf-chart-wrap");
  const table = document.getElementById("perf-table");
  const showingTable = !table.classList.contains("hidden");
  if (showingTable) {
    table.classList.add("hidden");
    chart.classList.remove("hidden");
    document.getElementById("perf-table-toggle").textContent = "View as table";
  } else {
    table.classList.remove("hidden");
    chart.classList.add("hidden");
    document.getElementById("perf-table-toggle").textContent = "View as chart";
  }
});

(async function init() {
  try {
    await loadData();
    renderStatRow();
    renderPerfChart();
    renderGrid();
  } catch (err) {
    document.getElementById("meta-line").textContent = "Failed to load data.";
    console.error(err);
  }
})();
