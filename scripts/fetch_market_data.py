#!/usr/bin/env python3
"""
Fetches live price, performance, sector composition and top-holdings data
for every ETF listed in etfs.json using Yahoo Finance (yfinance), then
computes the strongest/weakest performing holding within each basket.

Output: docs/data/market_data.json (consumed by the frontend).
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
ETFS_FILE = ROOT / "etfs.json"
OUT_FILE = ROOT / "docs" / "data" / "market_data.json"
ETFS_COPY_FILE = ROOT / "docs" / "etfs.json"
PROFILES_FILE = ROOT / "manager_profiles.json"
PROFILES_COPY_FILE = ROOT / "docs" / "manager_profiles.json"

TOP_N_HOLDINGS = 6
SPARKLINE_DAYS = 90


def pct_change(series):
    if series is None or len(series) < 2:
        return None
    first, last = series.iloc[0], series.iloc[-1]
    if first == 0:
        return None
    return round((last - first) / first * 100, 2)


def fetch_etf(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    result = {"ticker": ticker, "error": None}

    try:
        info = t.info or {}
    except Exception as e:
        info = {}
        result["error"] = f"info fetch failed: {e}"

    result["currency"] = info.get("currency", "USD")
    result["aum"] = info.get("totalAssets")
    result["fund_family"] = info.get("fundFamily")

    try:
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
    except Exception as e:
        hist = None
        result["error"] = f"history fetch failed: {e}"

    if hist is not None and not hist.empty:
        closes = hist["Close"].dropna()
        result["price"] = round(float(closes.iloc[-1]), 2)
        result["change_1d_pct"] = pct_change(closes.tail(2))
        result["change_1y_pct"] = pct_change(closes)
        # YTD: first trading day of the current calendar year
        this_year = closes[closes.index.year == datetime.now().year]
        result["change_ytd_pct"] = pct_change(this_year) if len(this_year) > 1 else None
        # sparkline: last N closes as (date, close) pairs
        tail = closes.tail(SPARKLINE_DAYS)
        result["history"] = [
            {"date": idx.strftime("%Y-%m-%d"), "close": round(float(v), 2)}
            for idx, v in tail.items()
        ]
    else:
        result["price"] = None
        result["change_1d_pct"] = None
        result["change_1y_pct"] = None
        result["change_ytd_pct"] = None
        result["history"] = []

    # Composition: sector weights + top holdings (not available for commodity
    # trusts like GLD, so fail gracefully)
    result["sector_weights"] = {}
    result["top_holdings"] = []
    try:
        fd = t.funds_data
        if fd is not None:
            sw = fd.sector_weightings or {}
            result["sector_weights"] = {
                k: round(v * 100, 2) for k, v in sw.items()
            }
            th = fd.top_holdings
            if th is not None and not th.empty:
                holdings = []
                for symbol, row in th.head(TOP_N_HOLDINGS).iterrows():
                    holdings.append({
                        "symbol": symbol,
                        "name": row.get("Name", symbol),
                        "weight_pct": round(float(row.get("Holding Percent", 0)) * 100, 2),
                    })
                result["top_holdings"] = holdings
    except Exception as e:
        result["holdings_error"] = str(e)

    return result


def enrich_holding_performance(etf_results: dict):
    """Fetch 1y performance for every unique top-holding symbol, then tag
    each ETF's strongest/weakest current holding."""
    symbols = set()
    for etf in etf_results.values():
        for h in etf["top_holdings"]:
            symbols.add(h["symbol"])

    perf = {}
    for sym in sorted(symbols):
        try:
            hist = yf.Ticker(sym).history(period="1y", interval="1d", auto_adjust=True)
            closes = hist["Close"].dropna()
            perf[sym] = pct_change(closes)
        except Exception:
            perf[sym] = None
        time.sleep(0.05)

    for etf in etf_results.values():
        best, worst = None, None
        for h in etf["top_holdings"]:
            h["change_1y_pct"] = perf.get(h["symbol"])
            if h["change_1y_pct"] is None:
                continue
            if best is None or h["change_1y_pct"] > best["change_1y_pct"]:
                best = h
            if worst is None or h["change_1y_pct"] < worst["change_1y_pct"]:
                worst = h
        etf["strongest_holding"] = best
        etf["weakest_holding"] = worst


def main():
    etfs = json.loads(ETFS_FILE.read_text())
    tickers = [e["ticker"] for e in etfs]

    # keep the frontend's copies (served from /docs) in sync with the seed files
    ETFS_COPY_FILE.parent.mkdir(parents=True, exist_ok=True)
    ETFS_COPY_FILE.write_text(json.dumps(etfs, indent=2))
    if PROFILES_FILE.exists():
        PROFILES_COPY_FILE.write_text(PROFILES_FILE.read_text())

    results = {}
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] fetching {ticker}...", file=sys.stderr)
        try:
            results[ticker] = fetch_etf(ticker)
        except Exception as e:
            print(f"  FAILED {ticker}: {e}", file=sys.stderr)
            results[ticker] = {"ticker": ticker, "error": str(e)}
        time.sleep(0.2)

    print("computing strongest/weakest holdings across baskets...", file=sys.stderr)
    enrich_holding_performance(results)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "etfs": results,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2))
    print(f"wrote {OUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
