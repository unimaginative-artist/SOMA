#!/usr/bin/env python3
"""
scripts/market_bridge.py

SOMA market data bridge — called by Node.js via child_process.
Uses yfinance (installed via openbb) for real price + historical data.
Outputs clean JSON to stdout. Errors go to stderr, never corrupt stdout.

Commands:
  python market_bridge.py quotes          — live quotes for all assets
  python market_bridge.py history SYMBOL  — 1yr daily OHLCV for backtesting
  python market_bridge.py news SYMBOL     — recent news for a symbol
  python market_bridge.py wsb             — r/wallstreetbets deep scan
"""

import sys
import json
import datetime

def safe_float(v):
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)  # NaN check
    except (TypeError, ValueError):
        return None


# ── Quotes ────────────────────────────────────────────────────────────────

def get_quotes():
    import yfinance as yf

    SYMBOLS = {
        # Crypto
        'BTC':  'BTC-USD',  'ETH':  'ETH-USD',  'SOL':  'SOL-USD',
        'AVAX': 'AVAX-USD', 'LINK': 'LINK-USD',  'DOT':  'DOT-USD',
        'UNI':  'UNI-USD',  'AAVE': 'AAVE-USD',
        # Stocks
        'NVDA': 'NVDA',  'MSFT': 'MSFT',  'AAPL': 'AAPL',  'META': 'META',
        'GOOGL':'GOOGL', 'AMZN': 'AMZN',  'TSLA': 'TSLA',  'AMD':  'AMD',
        # Futures
        'ES':   'ES=F',  'NQ':   'NQ=F',  'CL':   'CL=F',
        'GC':   'GC=F',  'SI':   'SI=F',  'ZB':   'ZB=F',
    }

    results = {}
    # Batch download is faster than individual Ticker calls
    tickers_str = ' '.join(SYMBOLS.values())
    data = yf.download(tickers=tickers_str, period='2d', interval='1h',
                       group_by='ticker', auto_adjust=True, progress=False)

    for sym_id, yf_sym in SYMBOLS.items():
        try:
            if len(SYMBOLS) > 1:
                df = data[yf_sym] if yf_sym in data.columns.get_level_values(0) else None
            else:
                df = data

            if df is None or df.empty:
                continue

            price = safe_float(df['Close'].dropna().iloc[-1])
            open_  = safe_float(df['Open'].dropna().iloc[0])
            high   = safe_float(df['High'].dropna().max())
            low    = safe_float(df['Low'].dropna().min())
            vol    = safe_float(df['Volume'].dropna().sum())

            if price is None:
                continue

            change24h = round((price - open_) / open_ * 100, 3) if open_ else None
            results[sym_id] = {
                'price': price, 'open': open_, 'high': high, 'low': low,
                'volume': vol, 'change24h': change24h,
            }
        except Exception as e:
            sys.stderr.write(f'[market_bridge] {sym_id} quote error: {e}\n')

    print(json.dumps({'ok': True, 'quotes': results, 'ts': int(datetime.datetime.now().timestamp() * 1000)}))


# ── History ────────────────────────────────────────────────────────────────

def get_history(symbol):
    import yfinance as yf

    YF_MAP = {
        'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD', 'AVAX': 'AVAX-USD',
        'LINK': 'LINK-USD', 'DOT': 'DOT-USD', 'UNI': 'UNI-USD', 'AAVE': 'AAVE-USD',
        'ES': 'ES=F', 'NQ': 'NQ=F', 'CL': 'CL=F', 'GC': 'GC=F', 'SI': 'SI=F', 'ZB': 'ZB=F',
    }
    yf_sym = YF_MAP.get(symbol.upper(), symbol.upper())

    ticker = yf.Ticker(yf_sym)
    df = ticker.history(period='2y', interval='1d', auto_adjust=True)

    if df.empty:
        print(json.dumps({'ok': False, 'error': f'No data for {symbol}'}))
        return

    rows = []
    for ts, row in df.iterrows():
        rows.append({
            'date': ts.strftime('%Y-%m-%d'),
            'open':  safe_float(row['Open']),
            'high':  safe_float(row['High']),
            'low':   safe_float(row['Low']),
            'close': safe_float(row['Close']),
            'volume': safe_float(row['Volume']),
        })

    print(json.dumps({'ok': True, 'symbol': symbol, 'rows': rows}))


# ── News ──────────────────────────────────────────────────────────────────

def get_news(symbol):
    import yfinance as yf

    YF_MAP = {
        'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD',
        'ES': 'ES=F', 'NQ': 'NQ=F', 'CL': 'CL=F', 'GC': 'GC=F',
    }
    yf_sym = YF_MAP.get(symbol.upper(), symbol.upper())

    ticker = yf.Ticker(yf_sym)
    raw_news = getattr(ticker, 'news', []) or []

    articles = []
    for item in raw_news[:15]:
        content = item.get('content', {})
        title = (content.get('title') or item.get('title') or '').strip()
        summary = (content.get('summary') or item.get('summary') or '').strip()
        publisher = (content.get('provider', {}).get('displayName') or
                     item.get('publisher') or 'Unknown')
        pub_date = content.get('pubDate') or ''
        url = (content.get('canonicalUrl', {}).get('url') or
               item.get('link') or '')

        if title:
            articles.append({
                'title': title,
                'summary': summary[:200] if summary else '',
                'publisher': publisher,
                'pubDate': pub_date,
                'url': url,
            })

    print(json.dumps({'ok': True, 'symbol': symbol, 'articles': articles}))


# ── WSB Deep Scan ──────────────────────────────────────────────────────────

def get_wsb():
    import urllib.request
    import re

    BULL_WORDS = ['moon', 'bull', 'calls', 'buy', 'long', 'yolo', 'squeeze',
                  'rocket', 'gains', 'pump', 'breakout', 'upside', 'rally']
    BEAR_WORDS = ['puts', 'short', 'crash', 'bear', 'dump', 'sell', 'drop',
                  'rekt', 'loss', 'correction', 'downside', 'overvalued']
    DD_FLAIR   = ['dd', 'due diligence', 'analysis', 'research']
    FLOW_FLAIR = ['options flow', 'unusual activity', 'dark pool', 'options']

    # Fetch hot + new + top posts
    posts = []
    for feed in ['hot', 'top']:
        url = f'https://www.reddit.com/r/wallstreetbets/{feed}.json?limit=50&t=day'
        req = urllib.request.Request(url, headers={'User-Agent': 'SOMA-MarketBridge/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read())
            posts.extend(data['data']['children'])
        except Exception as e:
            sys.stderr.write(f'[market_bridge] WSB {feed} fetch error: {e}\n')

    # Deduplicate by post ID
    seen = set()
    unique_posts = []
    for p in posts:
        pid = p['data'].get('id')
        if pid and pid not in seen:
            seen.add(pid)
            unique_posts.append(p['data'])

    # Extract tickers — look for $TICKER or all-caps 2-5 char words
    TICKER_RE = re.compile(r'\$([A-Z]{1,5})\b|(?<!\w)([A-Z]{2,5})(?!\w)')
    COMMON_WORDS = {'DD', 'THE', 'AND', 'FOR', 'YOU', 'ARE', 'NOT', 'BUT', 'ALL',
                    'CAN', 'HAS', 'WAS', 'NOW', 'OUT', 'GET', 'ITS', 'HIS', 'HER',
                    'OUR', 'THIS', 'THAT', 'WITH', 'HAVE', 'FROM', 'THEY', 'WILL',
                    'WHAT', 'WHEN', 'WERE', 'BEEN', 'SOME', 'MORE', 'VERY', 'JUST',
                    'INTO', 'OVER', 'THAN', 'THEN', 'THEM', 'ALSO', 'BACK', 'AFTER',
                    'YOLO', 'WSB', 'GME', 'AMC', 'FOMO', 'HODL', 'MOON', 'CALL',
                    'PUT', 'PUTS', 'CALLS', 'APES', 'APE', 'STOCK', 'LOSS', 'GAIN'}

    ticker_counts = {}
    bull_count = 0
    bear_count = 0
    dd_posts = []
    flow_posts = []
    scored_posts = []

    for post in unique_posts:
        if post.get('stickied'):
            continue

        title = post.get('title', '')
        flair = (post.get('link_flair_text') or '').lower()
        score = post.get('score', 0)
        comments = post.get('num_comments', 0)
        permalink = post.get('permalink', '')
        selftext = (post.get('selftext', '') or '')[:500]

        full_text = f"{title} {selftext}".lower()

        # Sentiment
        bull_hits = sum(1 for w in BULL_WORDS if w in full_text)
        bear_hits = sum(1 for w in BEAR_WORDS if w in full_text)
        if bull_hits > bear_hits:
            bull_count += 1
        elif bear_hits > bull_hits:
            bear_count += 1

        # Ticker extraction
        matches = TICKER_RE.findall(f"{title} {selftext}")
        tickers_in_post = set()
        for m in matches:
            ticker = (m[0] or m[1]).upper()
            if ticker and ticker not in COMMON_WORDS and len(ticker) >= 2:
                tickers_in_post.add(ticker)
                ticker_counts[ticker] = ticker_counts.get(ticker, 0) + 1

        # Classify post type
        is_dd = any(kw in flair for kw in DD_FLAIR)
        is_flow = any(kw in flair for kw in FLOW_FLAIR)

        post_data = {
            'title': title,
            'score': score,
            'comments': comments,
            'flair': flair,
            'tickers': list(tickers_in_post),
            'sentiment': 'bull' if bull_hits > bear_hits else 'bear' if bear_hits > bull_hits else 'neutral',
            'url': f"https://reddit.com{permalink}",
            'preview': selftext[:200] if selftext else '',
        }

        if is_dd and score > 50:
            thesis = _extract_dd_thesis(selftext)
            post_data['thesis'] = thesis
            dd_posts.append(post_data)
        if is_flow:
            flow_posts.append(post_data)

        scored_posts.append(post_data)

    # Sort tickers by mention count, filter noise
    hot_tickers = sorted(
        [(t, c) for t, c in ticker_counts.items() if c >= 2],
        key=lambda x: -x[1]
    )[:20]

    total_sentiment = bull_count + bear_count or 1
    sentiment_score = bull_count / total_sentiment

    print(json.dumps({
        'ok': True,
        'sentiment': round(sentiment_score, 3),
        'sentimentLabel': 'BULLISH' if sentiment_score > 0.6 else 'BEARISH' if sentiment_score < 0.4 else 'NEUTRAL',
        'bullCount': bull_count,
        'bearCount': bear_count,
        'hotTickers': [{'ticker': t, 'mentions': c} for t, c in hot_tickers],
        'ddPosts': dd_posts[:5],
        'flowPosts': flow_posts[:5],
        'topPosts': sorted(scored_posts, key=lambda p: -(p['score'] + p['comments'] * 2))[:10],
        'totalScanned': len(unique_posts),
    }))


# ── Options Flow ──────────────────────────────────────────────────────────

def get_options(symbol):
    import yfinance as yf
    import re as _re

    YF_MAP = {
        'BTC': 'BTC-USD', 'ETH': 'ETH-USD',
        'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM',
        'NVDA': 'NVDA', 'AAPL': 'AAPL', 'MSFT': 'MSFT',
        'TSLA': 'TSLA', 'AMD': 'AMD', 'META': 'META',
        'GOOGL': 'GOOGL', 'AMZN': 'AMZN',
    }
    yf_sym = YF_MAP.get(symbol.upper(), symbol.upper())

    try:
        ticker = yf.Ticker(yf_sym)
        exp_dates = ticker.options
        if not exp_dates:
            print(json.dumps({'ok': False, 'error': 'No options data available'}))
            return

        # Nearest two expiries
        chain = ticker.option_chain(exp_dates[0])
        calls = chain.calls.fillna(0)
        puts  = chain.puts.fillna(0)

        call_vol = int(calls['volume'].sum())
        put_vol  = int(puts['volume'].sum())
        call_oi  = int(calls['openInterest'].sum())
        put_oi   = int(puts['openInterest'].sum())

        pc_ratio_vol = round(put_vol / max(call_vol, 1), 3)
        pc_ratio_oi  = round(put_oi  / max(call_oi,  1), 3)

        # Unusual activity: volume > 5× mean for that side
        def unusual(df, side):
            avg = df['volume'].mean() or 1
            hot = df[df['volume'] > avg * 5][['strike', 'volume', 'openInterest', 'impliedVolatility']].head(5)
            rows = []
            for _, r in hot.iterrows():
                rows.append({
                    'strike': safe_float(r['strike']),
                    'volume': int(r['volume']),
                    'openInterest': int(r['openInterest']),
                    'iv': safe_float(r['impliedVolatility']),
                    'side': side,
                })
            return rows

        unusual_activity = unusual(calls, 'call') + unusual(puts, 'put')
        unusual_activity.sort(key=lambda x: -x['volume'])

        sentiment = 'BEARISH' if pc_ratio_vol > 1.3 else 'BULLISH' if pc_ratio_vol < 0.7 else 'NEUTRAL'

        print(json.dumps({
            'ok': True,
            'symbol': symbol,
            'expiry': exp_dates[0],
            'putCallRatioVol': pc_ratio_vol,
            'putCallRatioOI':  pc_ratio_oi,
            'callVolume': call_vol,
            'putVolume':  put_vol,
            'callOI': call_oi,
            'putOI':  put_oi,
            'sentiment': sentiment,
            'unusualActivity': unusual_activity[:8],
        }))

    except Exception as e:
        sys.stderr.write(f'[market_bridge] options error for {symbol}: {e}\n')
        print(json.dumps({'ok': False, 'error': str(e)}))


# ── WSB thesis extractor ──────────────────────────────────────────────────

def _extract_dd_thesis(text):
    """Pull structured intel from a DD post body."""
    import re as _re

    text = text[:1500]

    # Price targets: "$150 target", "PT $200", "price target: 250"
    price_targets = []
    for m in _re.findall(r'(?:pt|price target|target)[:\s]*\$?\s*(\d+(?:\.\d+)?)', text, _re.IGNORECASE):
        try:
            price_targets.append(float(m))
        except:
            pass
    for m in _re.findall(r'\$\s*(\d{2,6}(?:\.\d+)?)\s+(?:target|by|eod|eow|eom)', text, _re.IGNORECASE):
        try:
            price_targets.append(float(m))
        except:
            pass

    # Catalyst type
    catalysts = []
    CATALYST_MAP = {
        'earnings':  ['earnings', 'eps', 'beat', 'revenue'],
        'fda':       ['fda', 'phase 3', 'approval', 'trial results'],
        'merger':    ['merger', 'acquisition', 'buyout', 'takeover'],
        'squeeze':   ['short squeeze', 'gamma squeeze', 'high si', 'short interest'],
        'macro':     ['fed', 'rate cut', 'cpi', 'inflation', 'fomc'],
        'technical': ['breakout', 'cup and handle', 'support', 'resistance', 'golden cross'],
        'insider':   ['insider buying', 'unusual options', 'dark pool', 'block trade'],
    }
    lower = text.lower()
    for cat, keywords in CATALYST_MAP.items():
        if any(kw in lower for kw in keywords):
            catalysts.append(cat)

    # Time horizon
    time_horizon = 'unspecified'
    if any(w in lower for w in ['today', '0dte', '1dte', 'eod', 'tomorrow']):
        time_horizon = 'intraday'
    elif any(w in lower for w in ['this week', 'eow', 'weekly', 'friday']):
        time_horizon = 'weekly'
    elif any(w in lower for w in ['this month', 'eom', 'monthly', 'q1', 'q2', 'q3', 'q4']):
        time_horizon = 'monthly'
    elif any(w in lower for w in ['this year', 'next year', '2025', '2026', 'long term']):
        time_horizon = 'long-term'

    return {
        'priceTargets': list(set(price_targets))[:3],
        'catalysts': catalysts,
        'timeHorizon': time_horizon,
    }


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'quotes'
    try:
        if cmd == 'quotes':
            get_quotes()
        elif cmd == 'history' and len(sys.argv) > 2:
            get_history(sys.argv[2])
        elif cmd == 'news' and len(sys.argv) > 2:
            get_news(sys.argv[2])
        elif cmd == 'wsb':
            get_wsb()
        elif cmd == 'options' and len(sys.argv) > 2:
            get_options(sys.argv[2])
        else:
            print(json.dumps({'ok': False, 'error': f'Unknown command: {cmd}'}))
    except Exception as e:
        import traceback
        sys.stderr.write(traceback.format_exc())
        print(json.dumps({'ok': False, 'error': str(e)}))
