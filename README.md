# ETF Basket Analysis

A trading-desk-style reference dashboard for the 20 largest ETFs by assets under management: composition, performance across multiple horizons, risk/trading metrics (beta, volatility, Sharpe, max drawdown, tracking error, bid-ask spread, options snapshot), a cross-fund correlation matrix, a side-by-side comparison/overlap tool, and a hover-glossary for the finance jargon. Hover a card for a quick profile; click through for the full profile, holdings, and recent news; print any profile as a clean one-pager.

**Live site:** enable GitHub Pages (Settings → Pages → source: `main` branch, `/docs` folder) and it'll be served at `https://<your-username>.github.io/ETF-basket-analysis/`.

## Data sources & limitations

- **Prices, performance, sector weights, top holdings, AUM, bid/ask, volume, options chains** — [Yahoo Finance](https://finance.yahoo.com) via the [`yfinance`](https://github.com/ranaroussi/yfinance) library. Free, no API key. Refreshed on a schedule (see below) — not tick-by-tick real time.
- **News** — [NewsAPI.org](https://newsapi.org) free tier. Requires your own free API key (see setup below); until one is added, the site shows a clear placeholder instead of fake data. Free tier caps at 100 requests/day, shared across however many machines use the same key.
- **Bloomberg** was requested as a source but its market/news data requires a paid Terminal or B-PIPE license this project doesn't have access to. Yahoo Finance + NewsAPI are the practical free equivalents; swap in a paid provider in `scripts/fetch_market_data.py` / `scripts/fetch_news.py` if you have API access.
- **Holdings depth**: Yahoo's free API discloses at most a fund's top 10 holdings by weight, not its complete constituent list (which can run into the hundreds for broad index funds). The holdings-overlap tool is explicitly labeled as a lower-bound estimate for this reason.
- **Tracking error**: only computed for the four funds with an exact free benchmark index available (`VOO`/`IVV`/`SPY` vs `^GSPC`, `QQQ` vs `^NDX`); shown as N/A elsewhere rather than compared against a mismatched benchmark. It's also measured against a price-only index (no dividends), so it reads a bit higher than each fund's official total-return tracking error — noted inline in the UI.
- **Authorized Participants**: current fund-specific AP rosters are not public data — issuers only share them via broker-dealer-restricted portals. The site is upfront about this and instead lists the major banks/trading firms that serve as APs across the ETF industry broadly (a real, sourceable fact, just not fund-specific).
- **Currency**: each card and modal shows the fund's actual trading currency (badge). All 20 seed funds trade in USD; the code doesn't assume this if you add non-USD tickers.
- **Fund selection**: `etfs.json` is a curated, static list of 20 well-known large ETFs (ticker, manager, category, inception date, expense ratio, description, political/success-factor context) — not a live AUM leaderboard, since that requires a paid data feed to keep accurate in real time. AUM shown per-fund *is* fetched live from Yahoo Finance.

## How the "strongest/weakest" calculation works

For each ETF, the pipeline fetches its top 10 holdings by weight, then pulls each holding's own trailing 1-year price change. The holding with the highest 1Y % change is tagged **Strongest**, the lowest **Weakest**, inside that fund's modal. Funds with no disclosed equity holdings (e.g. `GLD`, a physical gold trust) show an explanatory note instead.

## Risk & trading metrics

Computed per fund from 5 years of daily price history: beta vs. the S&P 500 (universal market proxy, works for any fund), annualized volatility, Sharpe ratio (using the 13-week T-bill as the risk-free rate), max drawdown, tracking error (where a matching benchmark exists), live bid/ask spread, average daily volume, and a nearest-expiration options snapshot (implied vol, open interest, put/call ratio). A 20×20 cross-fund correlation matrix and a 2–4 fund comparison tool (with holdings-overlap %) sit in their own sections below the main grid.

## Glossary / hover terms

Any dotted-underline term (Beta, Sharpe Ratio, Tracking Error, Authorized Participant, etc.) shows a plain-language definition on hover. Definitions live in `glossary.json` at the repo root.

## Project layout

```
etfs.json                 seed metadata: ticker, name, manager, category, inception date, currency, expense ratio, description, political/success-factor context
glossary.json              term -> plain-language definition, powers the hover tooltips
manager_profiles.json      issuer bios (Vanguard, BlackRock, State Street, Invesco, Schwab)
scripts/
  fetch_market_data.py    pulls prices/performance/composition/risk metrics/options/correlation from Yahoo Finance -> docs/data/market_data.json
  fetch_news.py           pulls headlines from NewsAPI.org -> docs/data/news.json
docs/                     the static site (GitHub Pages root)
  index.html / app.js / styles.css
  etfs.json, glossary.json, manager_profiles.json   auto-synced copies of the root files (frontend can't read outside /docs)
  data/                   generated JSON consumed by the frontend
.github/workflows/update-data.yml   scheduled refresh (every 4 hours) + on-demand via workflow_dispatch
```

## Local development

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python3 scripts/fetch_market_data.py
NEWSAPI_KEY=your_key_here python3 scripts/fetch_news.py   # omit NEWSAPI_KEY to run without news

python3 -m http.server 8000 --directory docs
# open http://localhost:8000
```

## Enabling live news

1. Get a free key at [newsapi.org](https://newsapi.org/register).
2. In this repo: **Settings → Secrets and variables → Actions → New repository secret**, name it `NEWSAPI_KEY`, paste the key.
3. Re-run the "Refresh ETF data" workflow (or wait for the next scheduled run) — news will start populating in each ETF's modal.

## Refresh schedule

`.github/workflows/update-data.yml` runs every 4 hours, re-fetches all data, and commits the updated JSON straight to `main` (which GitHub Pages then serves). Trigger it manually anytime from the **Actions** tab (`Refresh ETF data` → `Run workflow`).

---
Not investment advice.
