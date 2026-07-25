#!/usr/bin/env python3
"""
Fetches live price, performance, trading, and composition data for every ETF
listed in etfs.json using Yahoo Finance (yfinance), then computes the
strongest/weakest performing holding within each basket, risk/trading
metrics (beta, volatility, Sharpe, max drawdown, tracking error, spreads,
options snapshot), and a cross-fund correlation matrix.

Output: docs/data/market_data.json (consumed by the frontend).
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
ETFS_FILE = ROOT / "etfs.json"
OUT_FILE = ROOT / "docs" / "data" / "market_data.json"
ETFS_COPY_FILE = ROOT / "docs" / "etfs.json"
PROFILES_FILE = ROOT / "manager_profiles.json"
PROFILES_COPY_FILE = ROOT / "docs" / "manager_profiles.json"
GLOSSARY_FILE = ROOT / "glossary.json"
GLOSSARY_COPY_FILE = ROOT / "docs" / "glossary.json"

TOP_N_HOLDINGS = 10  # Yahoo's free API caps disclosed holdings at 10
SPARKLINE_DAYS = 90
HISTORY_PERIOD = "5y"

# Only these funds have a free, exactly-matching index ticker available for
# true tracking-error calculation. For everything else we still compute beta
# vs the broad market (S&P 500), which is meaningful for any fund, but skip
# tracking error rather than compare against a benchmark that isn't actually
# the fund's own target index.
BENCHMARK_MAP = {
    "VOO": "^GSPC", "IVV": "^GSPC", "SPY": "^GSPC",
    "QQQ": "^NDX",
}
MARKET_BETA_BENCHMARK = "^GSPC"
RISK_FREE_TICKER = "^IRX"  # 13-week T-bill, annualized %


def pct_change(series):
    if series is None or len(series) < 2:
        return None
    first, last = series.iloc[0], series.iloc[-1]
    if first == 0:
        return None
    return round((last - first) / first * 100, 2)


def slice_since(series, **offset_kwargs):
    cutoff = series.index.max() - pd.DateOffset(**offset_kwargs)
    return series[series.index >= cutoff]


def daily_returns(series):
    return series.pct_change().dropna()


def annualized_vol(returns):
    if returns is None or len(returns) < 5:
        return None
    return round(float(returns.std() * (252 ** 0.5) * 100), 2)


def compute_beta(etf_returns, bench_returns):
    aligned = pd.concat([etf_returns, bench_returns], axis=1, join="inner").dropna()
    if len(aligned) < 20:
        return None
    aligned.columns = ["etf", "bench"]
    cov = aligned["etf"].cov(aligned["bench"])
    var = aligned["bench"].var()
    if var == 0:
        return None
    return round(float(cov / var), 2)


def compute_sharpe(returns, risk_free_annual_pct):
    if returns is None or len(returns) < 20:
        return None
    ann_return = float(returns.mean() * 252)
    ann_vol = float(returns.std() * (252 ** 0.5))
    if ann_vol == 0:
        return None
    rf = (risk_free_annual_pct or 0) / 100
    return round((ann_return - rf) / ann_vol, 2)


def compute_max_drawdown(series):
    if series is None or len(series) < 2:
        return None
    running_max = series.cummax()
    drawdown = (series - running_max) / running_max
    return round(float(drawdown.min() * 100), 2)


def compute_tracking_error(etf_returns, bench_returns):
    aligned = pd.concat([etf_returns, bench_returns], axis=1, join="inner").dropna()
    if len(aligned) < 20:
        return None
    aligned.columns = ["etf", "bench"]
    diff = aligned["etf"] - aligned["bench"]
    return round(float(diff.std() * (252 ** 0.5) * 100), 2)


def fetch_options_snapshot(ticker_obj):
    try:
        expirations = ticker_obj.options
        if not expirations:
            return None
        nearest = expirations[0]
        chain = ticker_obj.option_chain(nearest)
        calls, puts = chain.calls, chain.puts
        if calls.empty:
            return None
        call_oi = int(calls["openInterest"].fillna(0).sum())
        put_oi = int(puts["openInterest"].fillna(0).sum()) if not puts.empty else 0
        avg_iv = calls["impliedVolatility"].dropna()
        atm_iv = round(float(avg_iv.mean() * 100), 1) if len(avg_iv) else None
        return {
            "nearest_expiration": nearest,
            "atm_implied_vol_pct": atm_iv,
            "call_open_interest": call_oi,
            "put_open_interest": put_oi,
            "put_call_oi_ratio": round(put_oi / call_oi, 2) if call_oi else None,
            "expirations_available": len(expirations),
        }
    except Exception:
        return None


def fetch_etf(ticker: str, bench_series: dict, risk_free_pct: float) -> dict:
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
    result["avg_volume"] = info.get("averageVolume")
    bid, ask = info.get("bid"), info.get("ask")
    result["bid"] = bid
    result["ask"] = ask
    if bid and ask and bid > 0 and ask > 0:
        mid = (bid + ask) / 2
        result["spread_pct"] = round((ask - bid) / mid * 100, 4)
    else:
        result["spread_pct"] = None

    try:
        hist = t.history(period=HISTORY_PERIOD, interval="1d", auto_adjust=True)
    except Exception as e:
        hist = None
        result["error"] = f"history fetch failed: {e}"

    if hist is not None and not hist.empty:
        closes = hist["Close"].dropna()
        result["price"] = round(float(closes.iloc[-1]), 2)
        result["change_1d_pct"] = pct_change(closes.tail(2))
        result["change_1y_pct"] = pct_change(slice_since(closes, years=1))
        this_year = closes[closes.index.year == datetime.now().year]
        result["change_ytd_pct"] = pct_change(this_year) if len(this_year) > 1 else None
        result["change_1m_pct"] = pct_change(slice_since(closes, months=1))
        result["change_3m_pct"] = pct_change(slice_since(closes, months=3))
        result["change_6m_pct"] = pct_change(slice_since(closes, months=6))
        result["change_3y_pct"] = pct_change(slice_since(closes, years=3))
        result["change_5y_pct"] = pct_change(closes)

        tail = closes.tail(SPARKLINE_DAYS)
        result["history"] = [
            {"date": idx.strftime("%Y-%m-%d"), "close": round(float(v), 2)}
            for idx, v in tail.items()
        ]

        etf_returns_1y = daily_returns(slice_since(closes, years=1))
        result["volatility_pct"] = annualized_vol(etf_returns_1y)
        result["sharpe_ratio"] = compute_sharpe(etf_returns_1y, risk_free_pct)
        result["max_drawdown_5y_pct"] = compute_max_drawdown(closes)

        bench = bench_series.get(MARKET_BETA_BENCHMARK)
        result["beta_vs_sp500"] = compute_beta(etf_returns_1y, daily_returns(slice_since(bench, years=1))) if bench is not None else None

        own_bench_ticker = BENCHMARK_MAP.get(ticker)
        if own_bench_ticker and bench_series.get(own_bench_ticker) is not None:
            own_bench = bench_series[own_bench_ticker]
            result["tracking_error_pct"] = compute_tracking_error(
                etf_returns_1y, daily_returns(slice_since(own_bench, years=1))
            )
            result["benchmark_index"] = own_bench_ticker
        else:
            result["tracking_error_pct"] = None
            result["benchmark_index"] = None
    else:
        for k in ["price", "change_1d_pct", "change_1y_pct", "change_ytd_pct",
                   "change_1m_pct", "change_3m_pct", "change_6m_pct", "change_3y_pct",
                   "change_5y_pct", "volatility_pct", "sharpe_ratio", "max_drawdown_5y_pct",
                   "beta_vs_sp500", "tracking_error_pct", "benchmark_index"]:
            result[k] = None
        result["history"] = []

    result["sector_weights"] = {}
    result["top_holdings"] = []
    try:
        fd = t.funds_data
        if fd is not None:
            sw = fd.sector_weightings or {}
            result["sector_weights"] = {k: round(v * 100, 2) for k, v in sw.items()}
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

    result["options"] = fetch_options_snapshot(t)

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


def fetch_benchmarks():
    tickers = set(BENCHMARK_MAP.values()) | {MARKET_BETA_BENCHMARK}
    series = {}
    for sym in tickers:
        try:
            hist = yf.Ticker(sym).history(period=HISTORY_PERIOD, interval="1d", auto_adjust=True)
            series[sym] = hist["Close"].dropna()
        except Exception as e:
            print(f"  benchmark fetch failed for {sym}: {e}", file=sys.stderr)
            series[sym] = None
    return series


def fetch_risk_free_rate():
    try:
        hist = yf.Ticker(RISK_FREE_TICKER).history(period="5d")
        closes = hist["Close"].dropna()
        return float(closes.iloc[-1]) if len(closes) else 0.0
    except Exception:
        return 0.0


def compute_correlation_matrix(tickers, closes_by_ticker):
    frame = pd.DataFrame({
        tk: daily_returns(slice_since(s, years=1))
        for tk, s in closes_by_ticker.items() if s is not None and len(s) > 20
    })
    corr = frame.corr()
    return {a: {b: (round(float(corr.loc[a, b]), 2) if not pd.isna(corr.loc[a, b]) else None)
                for b in corr.columns} for a in corr.index}


def main():
    etfs = json.loads(ETFS_FILE.read_text())
    tickers = [e["ticker"] for e in etfs]

    # keep the frontend's copies (served from /docs) in sync with the seed files
    ETFS_COPY_FILE.parent.mkdir(parents=True, exist_ok=True)
    ETFS_COPY_FILE.write_text(json.dumps(etfs, indent=2))
    if PROFILES_FILE.exists():
        PROFILES_COPY_FILE.write_text(PROFILES_FILE.read_text())
    if GLOSSARY_FILE.exists():
        GLOSSARY_COPY_FILE.write_text(GLOSSARY_FILE.read_text())

    print("fetching benchmark indices and risk-free rate...", file=sys.stderr)
    bench_series = fetch_benchmarks()
    risk_free_pct = fetch_risk_free_rate()

    results = {}
    closes_by_ticker = {}
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] fetching {ticker}...", file=sys.stderr)
        try:
            results[ticker] = fetch_etf(ticker, bench_series, risk_free_pct)
            hist = yf.Ticker(ticker).history(period="1y", interval="1d", auto_adjust=True)
            closes_by_ticker[ticker] = hist["Close"].dropna()
        except Exception as e:
            print(f"  FAILED {ticker}: {e}", file=sys.stderr)
            results[ticker] = {"ticker": ticker, "error": str(e)}
        time.sleep(0.2)

    print("computing strongest/weakest holdings across baskets...", file=sys.stderr)
    enrich_holding_performance(results)

    print("computing cross-ETF correlation matrix...", file=sys.stderr)
    correlation_matrix = compute_correlation_matrix(tickers, closes_by_ticker)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "risk_free_rate_pct": round(risk_free_pct, 2),
        "etfs": results,
        "correlation_matrix": correlation_matrix,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2))
    print(f"wrote {OUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
