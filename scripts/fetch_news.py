#!/usr/bin/env python3
"""
Fetches recent news headlines relevant to each ETF (policy, politics, market
moves affecting the fund's holdings/sector) via NewsAPI.org.

Requires the NEWSAPI_KEY environment variable (free key from
https://newsapi.org). If it isn't set, writes an empty result set instead of
failing, so the rest of the pipeline still runs.

Output: docs/data/news.json
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
ETFS_FILE = ROOT / "etfs.json"
OUT_FILE = ROOT / "docs" / "data" / "news.json"

NEWSAPI_URL = "https://newsapi.org/v2/everything"
ARTICLES_PER_ETF = 6


class FetchFailed(Exception):
    """Raised for any failed fetch (rate limit, network error, bad response) so
    the caller can fall back to previously cached articles instead of wiping
    them out with an empty result."""


def fetch_news_for(ticker: str, name: str, api_key: str) -> list:
    # Some tickers (SPY, VIG, ...) double as common English words, so a bare
    # ticker match pulls in unrelated results (spy movies, etc). Requiring the
    # ticker appear as a "<TICKER> ETF/stock" phrase keeps matches on-topic;
    # the full fund name alone is always unambiguous.
    query = f'"{ticker} ETF" OR "{ticker} stock" OR "{name}"'
    params = {
        "q": query,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": ARTICLES_PER_ETF,
        "apiKey": api_key,
    }
    try:
        resp = requests.get(NEWSAPI_URL, params=params, timeout=15)
        if resp.status_code != 200:
            body = resp.json()
            print(f"  news fetch failed for {ticker}: HTTP {resp.status_code} "
                  f"code={body.get('code')} message={body.get('message')}", file=sys.stderr)
            raise FetchFailed(body.get("code"))
        data = resp.json()
    except FetchFailed:
        raise
    except Exception as e:
        print(f"  news fetch failed for {ticker}: {e}", file=sys.stderr)
        raise FetchFailed(str(e))

    articles = []
    for a in data.get("articles", [])[:ARTICLES_PER_ETF]:
        articles.append({
            "title": a.get("title"),
            "source": (a.get("source") or {}).get("name"),
            "url": a.get("url"),
            "published_at": a.get("publishedAt"),
            "description": a.get("description"),
        })
    return articles


def main():
    api_key = (os.environ.get("NEWSAPI_KEY") or "").strip()
    etfs = json.loads(ETFS_FILE.read_text())

    previous_news = {}
    if OUT_FILE.exists():
        try:
            previous_news = json.loads(OUT_FILE.read_text()).get("news", {})
        except Exception:
            previous_news = {}

    news = {}
    if not api_key:
        print("NEWSAPI_KEY not set - writing empty news set.", file=sys.stderr)
    else:
        for i, etf in enumerate(etfs, 1):
            ticker = etf["ticker"]
            print(f"[{i}/{len(etfs)}] fetching news for {ticker}...", file=sys.stderr)
            try:
                news[ticker] = fetch_news_for(ticker, etf["name"], api_key)
            except FetchFailed:
                # Keep whatever we had before rather than blanking out good
                # cached headlines because of a transient rate limit/error.
                if ticker in previous_news:
                    print(f"  falling back to previously cached articles for {ticker}", file=sys.stderr)
                    news[ticker] = previous_news[ticker]
                else:
                    news[ticker] = []
            time.sleep(1.1)  # stay under free-tier rate limits

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "has_key": bool(api_key),
        "news": news,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2))
    print(f"wrote {OUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
