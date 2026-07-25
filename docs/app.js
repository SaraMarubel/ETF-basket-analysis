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
let GLOSSARY = {};
let CORRELATION = {};
let RISK_FREE_PCT = null;

const AP_INDUSTRY_FIRMS = [
  "JPMorgan Securities", "Goldman Sachs & Co.", "Morgan Stanley & Co.",
  "BofA Securities (Merrill Lynch)", "Citigroup Global Markets", "Jane Street Capital",
  "Virtu Financial", "Susquehanna International Group", "RBC Capital Markets",
  "UBS Securities", "Cantor Fitzgerald",
];

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
  const [etfs, market, news, profiles, glossary] = await Promise.all([
    fetch("etfs.json").then(r => r.json()),
    fetch("data/market_data.json").then(r => r.json()),
    fetch("data/news.json").then(r => r.json()).catch(() => ({ news: {}, has_key: false })),
    fetch("manager_profiles.json").then(r => r.json()).catch(() => ({})),
    fetch("glossary.json").then(r => r.json()).catch(() => ({})),
  ]);
  ETFS = etfs;
  MARKET = market.etfs || {};
  NEWS = news.news || {};
  NEWS_HAS_KEY = !!news.has_key;
  MANAGER_PROFILES = profiles || {};
  GLOSSARY = glossary || {};
  CORRELATION = market.correlation_matrix || {};
  RISK_FREE_PCT = market.risk_free_rate_pct ?? null;

  document.getElementById("meta-line").innerHTML =
    `Updated <strong>${new Date(market.generated_at).toLocaleString()}</strong><br>20 ETFs tracked &middot; auto-refreshed on a schedule`;
}

function termSpan(label, glossaryKey) {
  const key = glossaryKey || label;
  return GLOSSARY[key] ? `<span class="term" data-term="${key}">${label}</span>` : label;
}

function wireGlossaryTerms(root) {
  (root || document).querySelectorAll(".term[data-term]").forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    el.addEventListener("mouseenter", (ev) => showGlossaryTip(ev, el.dataset.term));
    el.addEventListener("mousemove", positionHoverTip);
    el.addEventListener("mouseleave", hideHoverTip);
  });
}

function showGlossaryTip(ev, term) {
  const def = GLOSSARY[term];
  if (!def) return;
  hoverTip.innerHTML = `<div class="h-title">${term}</div><div class="g-def">${def}</div>`;
  hoverTip.classList.add("show");
  positionHoverTip(ev);
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
    return `<div class="bar-row">
      <div class="tk tk-link" data-ticker="${r.ticker}">${r.ticker}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%;"></div></div>
      <div class="val ${v >= 0 ? "delta-up" : "delta-down"}">${fmtPct(v, { decimals: 1 })}</div>
    </div>`;
  }).join("");

  document.getElementById("perf-table-body").innerHTML = rows.map(r => `
    <tr>
      <td class="tk-cell tk-link" data-ticker="${r.ticker}">${r.ticker}</td>
      <td>${r.name}</td>
      <td class="num ${r.m.change_1d_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_1d_pct)}</td>
      <td class="num ${r.m.change_1y_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_1y_pct)}</td>
      <td class="num ${r.m.change_ytd_pct >= 0 ? "delta-up" : "delta-down"}">${fmtPct(r.m.change_ytd_pct)}</td>
    </tr>`).join("");

  wireTickerLinks();
}

function wireTickerLinks() {
  document.querySelectorAll(".tk-link").forEach(el => {
    const ticker = el.dataset.ticker;
    const etf = ETFS.find(e => e.ticker === ticker);
    if (!etf) return;
    const m = MARKET[ticker] || {};
    el.addEventListener("mouseenter", (ev) => showHoverTip(ev, etf, m));
    el.addEventListener("mousemove", positionHoverTip);
    el.addEventListener("mouseleave", hideHoverTip);
    el.addEventListener("click", () => openModal(etf, m));
  });
}

function renderTopNews() {
  const container = document.getElementById("top-news-row");
  if (!NEWS_HAS_KEY) {
    container.innerHTML = `<div class="empty-note">Live news isn't wired up yet. Add a free API key from <a href="https://newsapi.org" target="_blank" rel="noopener">newsapi.org</a> as the <code>NEWSAPI_KEY</code> secret in this repo's GitHub settings, and the next scheduled refresh will populate this row.</div>`;
    return;
  }
  const seen = new Set();
  const all = [];
  Object.entries(NEWS).forEach(([ticker, items]) => {
    (items || []).forEach(a => {
      if (!a.title || seen.has(a.title)) return;
      seen.add(a.title);
      all.push({ ...a, ticker });
    });
  });
  all.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const top4 = all.slice(0, 4);
  if (top4.length === 0) {
    container.innerHTML = `<div class="empty-note">No recent headlines in the last fetch.</div>`;
    return;
  }
  container.innerHTML = top4.map(a => `
    <div class="top-news-tile">
      <div class="tk-tag">${a.ticker}</div>
      <a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
      <div class="src">${a.source || "Unknown source"} &middot; ${timeAgo(a.published_at)}</div>
    </div>`).join("");
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

let sortMode = "rank";
let filterUSOnly = true;
let selectedManagers = new Set();

function initFilters() {
  const managers = [...new Set(ETFS.map(e => e.manager))].sort();
  selectedManagers = new Set(managers);
  document.getElementById("manager-filters").innerHTML = managers.map(mgr => `
    <label class="check-pill"><input type="checkbox" class="manager-check" value="${mgr}" checked> ${mgr}</label>
  `).join("");
  document.querySelectorAll(".manager-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedManagers.add(cb.value); else selectedManagers.delete(cb.value);
      renderGrid();
    });
  });
  document.getElementById("filter-us").addEventListener("change", (e) => {
    filterUSOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    sortMode = e.target.value;
    renderGrid();
  });
}

function getVisibleETFs() {
  let list = ETFS.filter(e => selectedManagers.has(e.manager));
  if (filterUSOnly) {
    list = list.filter(e => (MARKET[e.ticker]?.currency || e.currency) === "USD");
  }
  if (sortMode === "alpha") {
    list = [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
  } else if (sortMode === "strongest") {
    list = [...list].sort((a, b) => (MARKET[b.ticker]?.change_1y_pct ?? -Infinity) - (MARKET[a.ticker]?.change_1y_pct ?? -Infinity));
  } else if (sortMode === "weakest") {
    list = [...list].sort((a, b) => (MARKET[a.ticker]?.change_1y_pct ?? Infinity) - (MARKET[b.ticker]?.change_1y_pct ?? Infinity));
  }
  return list;
}

function renderGrid() {
  const grid = document.getElementById("etf-grid");
  grid.innerHTML = "";
  const list = getVisibleETFs();
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-note">No ETFs match the current filters.</div>`;
    return;
  }
  list.forEach(etf => {
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

function metricTile(label, value, glossaryKey) {
  return `<div class="metric-tile"><div class="k">${termSpan(label, glossaryKey)}</div><div class="v">${value}</div></div>`;
}

function renderMetricsGrid(m) {
  const html = `<div class="metric-grid">
    ${metricTile("Beta (vs S&P 500)", m.beta_vs_sp500 ?? "—", "Beta")}
    ${metricTile("Volatility (ann.)", m.volatility_pct != null ? m.volatility_pct + "%" : "—", "Volatility")}
    ${metricTile("Sharpe Ratio", m.sharpe_ratio ?? "—", "Sharpe Ratio")}
    ${metricTile("Max Drawdown (5Y)", m.max_drawdown_5y_pct != null ? m.max_drawdown_5y_pct + "%" : "—", "Max Drawdown")}
    ${metricTile("Tracking Error", m.tracking_error_pct != null ? m.tracking_error_pct + "%" : "N/A", "Tracking Error")}
    ${metricTile("Bid-Ask Spread", m.spread_pct != null ? m.spread_pct + "%" : "—", "Bid-Ask Spread")}
    ${metricTile("Avg Daily Volume", m.avg_volume ? Math.round(m.avg_volume).toLocaleString() : "—", "Average Daily Volume")}
    ${metricTile("Risk-Free Rate", RISK_FREE_PCT != null ? RISK_FREE_PCT + "%" : "—", "Risk-Free Rate")}
  </div>`;
  const note = m.tracking_error_pct == null
    ? `<p class="metric-note">Tracking error N/A &mdash; no free total-return benchmark index feed available for this fund's specific target index (beta above still uses the S&P 500 as a universal market proxy, which works for any fund).</p>`
    : `<p class="metric-note">Tracking error is measured against a price-only index feed (dividends excluded), so it reads a bit higher than the fund's official total-return tracking error.</p>`;
  return html + note;
}

function horizonTile(label, v) {
  const cls = v == null ? "" : (v >= 0 ? "delta-up" : "delta-down");
  return `<div class="horizon-tile"><div class="k">${label}</div><div class="v ${cls}">${fmtPct(v, { decimals: 1 })}</div></div>`;
}

function renderHorizonRow(m) {
  return `<div class="horizon-row">
    ${horizonTile("1M", m.change_1m_pct)}
    ${horizonTile("3M", m.change_3m_pct)}
    ${horizonTile("6M", m.change_6m_pct)}
    ${horizonTile("YTD", m.change_ytd_pct)}
    ${horizonTile("1Y", m.change_1y_pct)}
    ${horizonTile("3Y", m.change_3y_pct)}
    ${horizonTile("5Y", m.change_5y_pct)}
  </div>`;
}

function renderOptionsSnapshot(opts) {
  if (!opts) {
    return `<div class="empty-note">No listed options market returned for this fund &mdash; either it has no active options chain, or liquidity is too thin for the nearest expiration to resolve.</div>`;
  }
  return `<div class="metric-grid">
    ${metricTile("Nearest Expiration", fmtDate(opts.nearest_expiration))}
    ${metricTile("ATM Implied Vol", opts.atm_implied_vol_pct != null ? opts.atm_implied_vol_pct + "%" : "—", "Implied Volatility")}
    ${metricTile("Call Open Interest", opts.call_open_interest != null ? opts.call_open_interest.toLocaleString() : "—", "Open Interest")}
    ${metricTile("Put Open Interest", opts.put_open_interest != null ? opts.put_open_interest.toLocaleString() : "—", "Open Interest")}
    ${metricTile("Put/Call OI Ratio", opts.put_call_oi_ratio ?? "—", "Put/Call Ratio")}
    ${metricTile("Expirations Listed", opts.expirations_available ?? "—")}
  </div>`;
}

function renderAPSection(etf) {
  return `<div class="ap-note-box">
    <span class="term" data-term="Authorized Participant">Authorized Participants</span> are the large broker-dealers contractually able to create and redeem large blocks of ${etf.ticker} shares directly with ${etf.manager} &mdash; they're the institutional plumbing that keeps the ETF's market price tethered to its NAV, and effectively the primary bulk "traders" of the fund.
    <br><br>
    <strong>A real data limit, stated plainly:</strong> the current fund-specific AP roster isn't public. Issuers only share it through broker-dealer-restricted portals (State Street's own AP resource page, for example, requires requesting SFTP credentials directly). What <em>is</em> publicly documented is the small set of major banks and trading firms that serve as Authorized Participants across the ETF industry broadly:
    <div class="ap-list">${AP_INDUSTRY_FIRMS.join(" &middot; ")}</div>
  </div>`;
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
      <div style="display:flex; align-items:flex-start; gap:8px;">
        <button class="print-btn" id="print-btn">Print / Export</button>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
    </div>

    <div class="fact-grid">
      <div class="fact"><div class="k">Price</div><div class="v">${fmtMoney(m.price, m.currency || etf.currency)}</div></div>
      <div class="fact"><div class="k">Currency</div><div class="v">${m.currency || etf.currency}</div></div>
      <div class="fact"><div class="k">1D change</div><div class="v ${(m.change_1d_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1d_pct)}</div></div>
      <div class="fact"><div class="k">1Y change</div><div class="v ${(m.change_1y_pct ?? 0) >= 0 ? "delta-up" : "delta-down"}">${fmtPct(m.change_1y_pct)}</div></div>
      <div class="fact"><div class="k">${termSpan("AUM")}</div><div class="v">${fmtBig(m.aum)}</div></div>
      <div class="fact"><div class="k">${termSpan("Expense Ratio")}</div><div class="v">${etf.expense_ratio}%</div></div>
      <div class="fact"><div class="k">Inception</div><div class="v">${fmtDate(etf.inception_date)}</div></div>
      <div class="fact"><div class="k">Fund age</div><div class="v">${age} years</div></div>
      <div class="fact"><div class="k">Manager</div><div class="v">${etf.manager}</div></div>
    </div>

    <h3>Performance across time horizons</h3>
    ${renderHorizonRow(m)}

    <h3>Trading &amp; risk metrics</h3>
    ${renderMetricsGrid(m)}

    <h3>Options market snapshot</h3>
    ${renderOptionsSnapshot(m.options)}

    <h3>What it is</h3>
    <p class="prose">${etf.description || "—"}</p>

    <h3>Who manages it</h3>
    <p class="prose">${MANAGER_PROFILES[etf.manager] || etf.manager}</p>

    <h3>Who typically holds/trades it</h3>
    <p class="prose">${etf.typical_holders || "—"}</p>
    ${renderAPSection(etf)}

    <h3>What makes it successful</h3>
    <p class="prose">${etf.success_factors || "—"}</p>

    <h3>Political &amp; policy exposure</h3>
    <p class="prose">${etf.political_context || "—"}</p>

    <h3>Composition by sector</h3>
    ${renderSectorBars(m.sector_weights)}

    <h3>Top holdings by weight &mdash; strongest &amp; weakest in the basket</h3>
    <p class="metric-note">Shows the fund's top ${(m.top_holdings || []).length || 10} holdings by weight, the maximum Yahoo's free data feed discloses &mdash; not the fund's complete constituent list, which can run into the hundreds for broad index funds.</p>
    ${renderHoldingsTable(m)}

    <h3>News affecting ${etf.ticker} (politics, policy, macro)</h3>
    ${renderNews(etf.ticker)}
  `;
  modalBackdrop.classList.remove("hidden");
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("print-btn").addEventListener("click", () => window.print());
  wireGlossaryTerms(modalBody);
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
    document.getElementById("perf-table-toggle").textContent = "View as graph";
  }
});

/* ---------- Compare tool ---------- */
let compareSelected = new Set();

function renderComparePicker() {
  const picker = document.getElementById("compare-picker");
  picker.innerHTML = ETFS.map(e =>
    `<label class="check-pill"><input type="checkbox" class="compare-check" value="${e.ticker}"> ${e.ticker}</label>`
  ).join("");
  document.querySelectorAll(".compare-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (compareSelected.size >= 4) { cb.checked = false; return; }
        compareSelected.add(cb.value);
      } else {
        compareSelected.delete(cb.value);
      }
      renderCompareOutput();
    });
  });
  renderCompareOutput();
}

function computeOverlap(a, b) {
  const holdA = MARKET[a]?.top_holdings || [];
  const holdB = MARKET[b]?.top_holdings || [];
  const mapB = Object.fromEntries(holdB.map(h => [h.symbol, h.weight_pct]));
  let overlap = 0;
  holdA.forEach(h => { if (mapB[h.symbol] != null) overlap += Math.min(h.weight_pct, mapB[h.symbol]); });
  return overlap;
}

function renderCompareOutput() {
  const out = document.getElementById("compare-output");
  const tickers = [...compareSelected];
  if (tickers.length < 2) {
    out.innerHTML = `<div class="empty-note">Select at least 2 ETFs above to compare (up to 4).</div>`;
    return;
  }
  const etfOf = tk => ETFS.find(e => e.ticker === tk);
  const rows = [
    ["Name", tk => etfOf(tk).name],
    ["Manager", tk => etfOf(tk).manager],
    [termSpan("Expense Ratio"), tk => etfOf(tk).expense_ratio + "%"],
    ["Price", tk => fmtMoney(MARKET[tk]?.price, MARKET[tk]?.currency || etfOf(tk).currency)],
    ["1Y Return", tk => fmtPct(MARKET[tk]?.change_1y_pct)],
    ["3Y Return", tk => fmtPct(MARKET[tk]?.change_3y_pct)],
    ["5Y Return", tk => fmtPct(MARKET[tk]?.change_5y_pct)],
    [termSpan("Beta", "Beta"), tk => MARKET[tk]?.beta_vs_sp500 ?? "—"],
    [termSpan("Volatility (ann.)", "Volatility"), tk => MARKET[tk]?.volatility_pct != null ? MARKET[tk].volatility_pct + "%" : "—"],
    [termSpan("Sharpe Ratio"), tk => MARKET[tk]?.sharpe_ratio ?? "—"],
    [termSpan("Max Drawdown (5Y)", "Max Drawdown"), tk => MARKET[tk]?.max_drawdown_5y_pct != null ? MARKET[tk].max_drawdown_5y_pct + "%" : "—"],
    [termSpan("Avg Daily Volume", "Average Daily Volume"), tk => MARKET[tk]?.avg_volume ? Math.round(MARKET[tk].avg_volume).toLocaleString() : "—"],
    [termSpan("AUM"), tk => fmtBig(MARKET[tk]?.aum)],
  ];
  let html = `<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th class="row-label">Metric</th>${tickers.map(tk => `<th>${tk}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach(([label, fn]) => {
    html += `<tr><th class="row-label">${label}</th>${tickers.map(tk => `<td>${fn(tk)}</td>`).join("")}</tr>`;
  });
  html += `</tbody></table></div>`;

  html += `<h3 style="margin-top:20px;">Holdings ${termSpan("overlap", "Overlap")} <span style="font-weight:400; color:var(--text-muted); font-size:11px;">(based on each fund's top-10 disclosed holdings &mdash; a lower bound, not full-portfolio overlap)</span></h3>`;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = tickers[i], b = tickers[j];
      const overlap = computeOverlap(a, b);
      html += `<div class="overlap-row"><div style="width:90px; flex-shrink:0;">${a} vs ${b}</div><div class="overlap-track"><div class="overlap-fill" style="width:${Math.min(overlap, 100)}%"></div></div><div>${overlap.toFixed(1)}%</div></div>`;
    }
  }
  out.innerHTML = html;
  wireGlossaryTerms(out);
}

/* ---------- Correlation matrix ---------- */
function hexToRgb(hex) {
  hex = hex.trim();
  if (hex.startsWith("rgb")) {
    const m = hex.match(/\d+/g).map(Number);
    return { r: m[0], g: m[1], b: m[2] };
  }
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function mixColor(hex1, hex2, t) {
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r},${g},${b})`;
}
function corrColor(v) {
  if (v == null) return cssVar("--gridline");
  const t = Math.max(-1, Math.min(1, v));
  return t >= 0 ? mixColor(cssVar("--gridline"), cssVar("--series-1"), t)
                : mixColor(cssVar("--gridline"), cssVar("--series-8"), -t);
}
function inkFor(rgbStr) {
  const m = rgbStr.match(/\d+/g).map(Number);
  const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
  return lum > 0.6 ? "#0b0b0b" : "#ffffff";
}

function renderCorrelationMatrix() {
  const tickers = ETFS.map(e => e.ticker).filter(tk => CORRELATION[tk]);
  const container = document.getElementById("corr-matrix");
  if (tickers.length === 0) {
    container.innerHTML = `<div class="empty-note">Correlation data not available.</div>`;
    return;
  }
  let html = `<div class="corr-grid" style="grid-template-columns: 50px repeat(${tickers.length}, 26px);">`;
  html += `<div></div>`;
  tickers.forEach(tk => { html += `<div class="corr-label">${tk}</div>`; });
  tickers.forEach(rowTk => {
    html += `<div class="corr-label row">${rowTk}</div>`;
    tickers.forEach(colTk => {
      const v = CORRELATION[rowTk] ? CORRELATION[rowTk][colTk] : null;
      const bg = corrColor(v);
      const ink = inkFor(bg);
      const label = v != null ? v.toFixed(1) : "—";
      const title = `${rowTk} vs ${colTk}: ${v != null ? v.toFixed(2) : "n/a"}`;
      html += `<div class="corr-cell" style="background:${bg}; color:${ink};" title="${title}">${label}</div>`;
    });
  });
  html += `</div>`;
  container.innerHTML = html;
}

(async function init() {
  try {
    await loadData();
    renderStatRow();
    renderTopNews();
    renderPerfChart();
    initFilters();
    renderGrid();
    renderComparePicker();
    renderCorrelationMatrix();
  } catch (err) {
    document.getElementById("meta-line").textContent = "Failed to load data.";
    console.error(err);
  }
})();
