# ETF Basket Analysis

A live-refreshed dashboard profiling the 20 largest ETFs by assets under management: composition (sector weights + top holdings), price performance, and the strongest/weakest-performing holding inside each basket. Hover a card for a quick profile (manager, fund age, 1-year change); click through for full composition, holdings, and recent news.

**Live site:** enable GitHub Pages (Settings → Pages → source: `main` branch, `/docs` folder) and it'll be served at `https://<your-username>.github.io/ETF-basket-analysis/`.

## Data sources & limitations

- **Prices, performance, sector weights, top holdings, AUM** — [Yahoo Finance](https://finance.yahoo.com) via the [`yfinance`](https://github.com/ranaroussi/yfinance) library. Free, no API key. Refreshed on a schedule (see below) — not tick-by-tick real time.
- **News** — [NewsAPI.org](https://newsapi.org) free tier. Requires your own free API key (see setup below); until one is added, the site shows a clear placeholder instead of fake data.
- **Bloomberg** was requested as a source but its market/news data requires a paid Terminal or B-PIPE license this project doesn't have access to. Yahoo Finance + NewsAPI are the practical free equivalents; swap in a paid provider in `scripts/fetch_market_data.py` / `scripts/fetch_news.py` if you have API access.
- **Currency**: each card and modal shows the fund's actual trading currency (badge). All 20 seed funds trade in USD; the code doesn't assume this if you add non-USD tickers.
- **Fund selection**: `etfs.json` is a curated, static list of 20 well-known large ETFs (ticker, manager, category, inception date, expense ratio) — not a live AUM leaderboard, since that requires a paid data feed to keep accurate in real time. AUM shown per-fund *is* fetched live from Yahoo Finance.

## How the "strongest/weakest" calculation works

For each ETF, the pipeline fetches its top ~6 holdings by weight, then pulls each holding's own trailing 1-year price change. The holding with the highest 1Y % change is tagged **Strongest**, the lowest **Weakest**, inside that fund's modal. Funds with no disclosed equity holdings (e.g. `GLD`, a physical gold trust) show an explanatory note instead.

## Project layout

```
etfs.json                 seed metadata: ticker, name, manager, category, inception date, currency, expense ratio
scripts/
  fetch_market_data.py    pulls prices/performance/composition from Yahoo Finance -> docs/data/market_data.json
  fetch_news.py           pulls headlines from NewsAPI.org -> docs/data/news.json
docs/                     the static site (GitHub Pages root)
  index.html / app.js / styles.css
  etfs.json               auto-synced copy of the root etfs.json (frontend can't read outside /docs)
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
