"""
Market Service - Stock and Crypto Data
Fetches market data from Yahoo Finance and CoinGecko
Provides technical analysis and predictions
"""

import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta
from typing import Dict, Optional, List
from .technical_indicators import calculate_all_indicators

# Cache for market data (5 minute expiry)
_market_cache = {}
_cache_duration = timedelta(minutes=5)

def get_market_intelligence(symbol: str) -> Optional[Dict]:
    """
    Get complete market intelligence for a symbol
    
    Args:
        symbol: Stock ticker (AAPL, MSFT) or crypto symbol (BTC-USD, ETH-USD)
    
    Returns:
        Dictionary with price data, technical indicators, and predictions
    """
    
    # Check cache
    cache_key = f"intel_{symbol}"
    if cache_key in _market_cache:
        cached_data, cached_time = _market_cache[cache_key]
        if datetime.now() - cached_time < _cache_duration:
            print(f"[MARKET] Using cached data for {symbol}")
            return cached_data
    
    try:
        # Fetch data from Yahoo Finance
        print(f"[MARKET] Fetching data for {symbol}")
        ticker = yf.Ticker(symbol)
        
        # Get historical data (6 months for good technical analysis)
        hist = ticker.history(period="6mo")
        
        if hist.empty:
            print(f"[MARKET] No data found for {symbol}")
            return None
        
        # Get ticker info
        try:
            info = ticker.info
        except:
            info = {}
        
        # Calculate technical indicators
        indicators = calculate_all_indicators(hist)
        
        # Get support/resistance levels
        support_resistance = _calculate_support_resistance(hist)
        
        # Generate prediction
        prediction = _generate_prediction(hist, indicators)
        
        # Assemble intelligence
        intelligence = {
            'symbol': symbol.upper(),
            'name': info.get('longName', symbol),
            'type': _detect_asset_type(symbol, info),
            'timestamp': datetime.now().isoformat(),
            'price': indicators['price'],
            'indicators': indicators,
            'levels': support_resistance,
            'prediction': prediction,
            'info': {
                'market_cap': info.get('marketCap'),
                'volume': info.get('volume'),
                'avg_volume': info.get('averageVolume'),
                'pe_ratio': info.get('trailingPE'),
                '52w_high': info.get('fiftyTwoWeekHigh'),
                '52w_low': info.get('fiftyTwoWeekLow'),
                'sector': info.get('sector'),
                'industry': info.get('industry')
            }
        }
        
        # Cache result
        _market_cache[cache_key] = (intelligence, datetime.now())
        
        return intelligence
        
    except Exception as e:
        print(f"[MARKET] Error fetching intelligence for {symbol}: {e}")
        return None

def get_crypto_intelligence(symbol: str) -> Optional[Dict]:
    """
    Get crypto-specific intelligence using CoinGecko API
    
    Args:
        symbol: Crypto symbol (bitcoin, ethereum, solana)
    
    Returns:
        Dictionary with crypto-specific data
    """
    
    try:
        # CoinGecko API (free, no key required)
        base_url = "https://api.coingecko.com/api/v3"
        
        # Get coin data
        coin_url = f"{base_url}/coins/{symbol.lower()}"
        params = {
            'localization': 'false',
            'tickers': 'false',
            'community_data': 'false',
            'developer_data': 'false'
        }
        
        response = requests.get(coin_url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        market_data = data.get('market_data', {})
        
        return {
            'symbol': symbol.upper(),
            'name': data.get('name'),
            'price_usd': market_data.get('current_price', {}).get('usd'),
            'market_cap': market_data.get('market_cap', {}).get('usd'),
            'volume_24h': market_data.get('total_volume', {}).get('usd'),
            'change_24h': market_data.get('price_change_percentage_24h'),
            'change_7d': market_data.get('price_change_percentage_7d'),
            'change_30d': market_data.get('price_change_percentage_30d'),
            'ath': market_data.get('ath', {}).get('usd'),
            'ath_change_pct': market_data.get('ath_change_percentage', {}).get('usd'),
            'atl': market_data.get('atl', {}).get('usd'),
            'circulating_supply': market_data.get('circulating_supply'),
            'total_supply': market_data.get('total_supply'),
            'max_supply': market_data.get('max_supply')
        }
        
    except Exception as e:
        print(f"[MARKET] Error fetching crypto data for {symbol}: {e}")
        return None

def search_symbol(query: str) -> List[Dict]:
    """
    Search for symbols matching query
    
    Args:
        query: Search term (company name or ticker)
    
    Returns:
        List of matching symbols
    """
    
    try:
        # Simple ticker validation
        ticker = yf.Ticker(query.upper())
        info = ticker.info
        
        if 'symbol' in info:
            return [{
                'symbol': info.get('symbol'),
                'name': info.get('longName', info.get('shortName', query)),
                'type': _detect_asset_type(query, info),
                'exchange': info.get('exchange')
            }]
        else:
            return []
            
    except:
        return []

def _detect_asset_type(symbol: str, info: Dict) -> str:
    """Detect if asset is stock, crypto, etf, etc."""
    
    symbol_upper = symbol.upper()
    
    # Crypto patterns
    if '-USD' in symbol_upper or 'BTC' in symbol_upper or 'ETH' in symbol_upper:
        return 'crypto'
    
    # Check info
    quote_type = info.get('quoteType', '').lower()
    if quote_type == 'cryptocurrency':
        return 'crypto'
    elif quote_type == 'etf':
        return 'etf'
    elif quote_type == 'equity':
        return 'stock'
    
    return 'stock'  # Default

def _calculate_support_resistance(df: pd.DataFrame) -> Dict:
    """Calculate support and resistance levels"""
    
    try:
        close = df['Close']
        high = df['High']
        low = df['Low']
        
        # Recent high/low (20 days)
        recent_high = float(high.tail(20).max())
        recent_low = float(low.tail(20).min())
        
        # 52-week high/low
        high_52w = float(high.max())
        low_52w = float(low.min())
        
        # Simple support/resistance from recent peaks
        resistance_1 = recent_high
        support_1 = recent_low
        
        # Pivot points (simplified)
        latest_high = float(high.iloc[-1])
        latest_low = float(low.iloc[-1])
        latest_close = float(close.iloc[-1])
        pivot = (latest_high + latest_low + latest_close) / 3
        
        resistance_2 = pivot + (latest_high - latest_low)
        support_2 = pivot - (latest_high - latest_low)
        
        return {
            'support': [round(support_2, 2), round(support_1, 2)],
            'resistance': [round(resistance_1, 2), round(resistance_2, 2)],
            'pivot': round(pivot, 2),
            '52w_high': round(high_52w, 2),
            '52w_low': round(low_52w, 2)
        }
        
    except Exception as e:
        print(f"[MARKET] Error calculating levels: {e}")
        return {
            'support': [],
            'resistance': [],
            'pivot': 0
        }

def _generate_prediction(df: pd.DataFrame, indicators: Dict) -> Dict:
    """
    Generate price prediction based on technical indicators
    """
    
    try:
        close = df['Close']
        latest_price = indicators['price']['current']
        
        # Get overall sentiment score
        score = indicators['overall_score']
        sentiment = score['sentiment']
        confidence = score['confidence']
        
        # Calculate predicted price movement
        if sentiment == 'bullish':
            if confidence == 'high':
                move_pct = 3.5  # 3.5% up
            else:
                move_pct = 1.8  # 1.8% up
        elif sentiment == 'bearish':
            if confidence == 'high':
                move_pct = -3.5  # 3.5% down
            else:
                move_pct = -1.8  # 1.8% down
        else:
            move_pct = 0.5  # Slight up bias for neutral
        
        # 3-day and 7-day predictions
        pred_3d = latest_price * (1 + move_pct / 100)
        pred_7d = latest_price * (1 + (move_pct * 1.5) / 100)
        
        # Calculate probability
        prob_up = score['score']
        prob_down = 100 - prob_up
        
        return {
            'direction': sentiment,
            'confidence': confidence,
            'probability': {
                'up': round(prob_up, 1),
                'down': round(prob_down, 1)
            },
            'targets': {
                '3_day': round(pred_3d, 2),
                '7_day': round(pred_7d, 2),
                'expected_move_pct': round(move_pct, 2)
            },
            'risk_reward': _calculate_risk_reward(latest_price, pred_7d, indicators),
            'recommendation': _generate_recommendation(sentiment, confidence, indicators)
        }
        
    except Exception as e:
        print(f"[MARKET] Error generating prediction: {e}")
        return {
            'direction': 'neutral',
            'confidence': 'low',
            'probability': {'up': 50, 'down': 50},
            'targets': {},
            'risk_reward': {},
            'recommendation': 'Hold - Insufficient data'
        }

def _calculate_risk_reward(current: float, target: float, indicators: Dict) -> Dict:
    """Calculate risk/reward ratio"""
    
    try:
        # Use support levels as stop loss
        supports = indicators.get('levels', {}).get('support', [current * 0.95])
        stop_loss = supports[0] if supports else current * 0.95
        
        potential_reward = target - current
        potential_risk = current - stop_loss
        
        ratio = abs(potential_reward / potential_risk) if potential_risk != 0 else 0
        
        return {
            'ratio': round(ratio, 2),
            'stop_loss': round(stop_loss, 2),
            'target': round(target, 2),
            'risk_dollars': round(potential_risk, 2),
            'reward_dollars': round(potential_reward, 2)
        }
        
    except:
        return {}

def _generate_recommendation(sentiment: str, confidence: str, indicators: Dict) -> str:
    """Generate trading recommendation"""
    
    rsi = indicators['momentum']['rsi']
    trend = indicators['trend']['trend']
    
    if sentiment == 'bullish' and confidence == 'high':
        if rsi < 30:
            return "STRONG BUY - Oversold with bullish signals"
        else:
            return "BUY - Multiple bullish indicators align"
    elif sentiment == 'bullish':
        return "ACCUMULATE - Cautious bullish stance"
    elif sentiment == 'bearish' and confidence == 'high':
        if rsi > 70:
            return "STRONG SELL - Overbought with bearish signals"
        else:
            return "SELL - Multiple bearish indicators align"
    elif sentiment == 'bearish':
        return "REDUCE - Cautious bearish stance"
    else:
        return "HOLD - Wait for clearer signals"
