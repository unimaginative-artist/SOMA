"""
Technical Indicators Service
Calculates RSI, MACD, Bollinger Bands, and other technical indicators
"""

import pandas as pd
import numpy as np
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.trend import MACD, EMAIndicator, SMAIndicator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import VolumeWeightedAveragePrice, OnBalanceVolumeIndicator
from typing import Dict, Optional

def calculate_all_indicators(df: pd.DataFrame) -> Dict:
    """
    Calculate all technical indicators for a given price dataframe
    
    Args:
        df: DataFrame with columns: Open, High, Low, Close, Volume
    
    Returns:
        Dictionary with all calculated indicators
    """
    
    try:
        close = df['Close']
        high = df['High']
        low = df['Low']
        volume = df['Volume']
        
        # Latest values
        latest_close = float(close.iloc[-1])
        prev_close = float(close.iloc[-2]) if len(close) > 1 else latest_close
        
        # RSI (14-period)
        rsi_indicator = RSIIndicator(close=close, window=14)
        rsi = float(rsi_indicator.rsi().iloc[-1])
        
        # MACD
        macd_indicator = MACD(close=close)
        macd_line = float(macd_indicator.macd().iloc[-1])
        macd_signal = float(macd_indicator.macd_signal().iloc[-1])
        macd_histogram = float(macd_indicator.macd_diff().iloc[-1])
        
        # Bollinger Bands (20-period, 2 std)
        bb_indicator = BollingerBands(close=close, window=20, window_dev=2)
        bb_upper = float(bb_indicator.bollinger_hband().iloc[-1])
        bb_middle = float(bb_indicator.bollinger_mavg().iloc[-1])
        bb_lower = float(bb_indicator.bollinger_lband().iloc[-1])
        bb_width = float(bb_indicator.bollinger_wband().iloc[-1])
        
        # Position within Bollinger Bands (0 = lower band, 1 = upper band)
        bb_position = (latest_close - bb_lower) / (bb_upper - bb_lower) if bb_upper != bb_lower else 0.5
        
        # Moving Averages
        sma_20 = float(SMAIndicator(close=close, window=20).sma_indicator().iloc[-1])
        sma_50 = float(SMAIndicator(close=close, window=50).sma_indicator().iloc[-1]) if len(close) >= 50 else sma_20
        ema_12 = float(EMAIndicator(close=close, window=12).ema_indicator().iloc[-1])
        ema_26 = float(EMAIndicator(close=close, window=26).ema_indicator().iloc[-1])
        
        # Stochastic Oscillator
        stoch = StochasticOscillator(high=high, low=low, close=close, window=14, smooth_window=3)
        stoch_k = float(stoch.stoch().iloc[-1])
        stoch_d = float(stoch.stoch_signal().iloc[-1])
        
        # Average True Range (volatility)
        atr = AverageTrueRange(high=high, low=low, close=close, window=14)
        atr_value = float(atr.average_true_range().iloc[-1])
        
        # Volume indicators
        obv = OnBalanceVolumeIndicator(close=close, volume=volume)
        obv_value = float(obv.on_balance_volume().iloc[-1])
        
        # Volume analysis
        avg_volume_20 = float(volume.tail(20).mean())
        latest_volume = float(volume.iloc[-1])
        volume_ratio = latest_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
        
        # Price change
        price_change = latest_close - prev_close
        price_change_pct = (price_change / prev_close * 100) if prev_close > 0 else 0
        
        # Signal generation
        signals = _generate_signals(
            rsi, macd_histogram, bb_position, stoch_k,
            latest_close, sma_20, sma_50, volume_ratio
        )
        
        return {
            'price': {
                'current': round(latest_close, 2),
                'change': round(price_change, 2),
                'change_pct': round(price_change_pct, 2)
            },
            'momentum': {
                'rsi': round(rsi, 2),
                'rsi_signal': _rsi_signal(rsi),
                'stochastic_k': round(stoch_k, 2),
                'stochastic_d': round(stoch_d, 2),
                'stoch_signal': _stoch_signal(stoch_k, stoch_d)
            },
            'trend': {
                'macd': round(macd_line, 4),
                'macd_signal': round(macd_signal, 4),
                'macd_histogram': round(macd_histogram, 4),
                'macd_trend': 'bullish' if macd_histogram > 0 else 'bearish',
                'sma_20': round(sma_20, 2),
                'sma_50': round(sma_50, 2),
                'ema_12': round(ema_12, 2),
                'ema_26': round(ema_26, 2),
                'trend': 'bullish' if latest_close > sma_20 > sma_50 else 'bearish' if latest_close < sma_20 < sma_50 else 'neutral'
            },
            'volatility': {
                'bb_upper': round(bb_upper, 2),
                'bb_middle': round(bb_middle, 2),
                'bb_lower': round(bb_lower, 2),
                'bb_width': round(bb_width, 4),
                'bb_position': round(bb_position, 2),
                'atr': round(atr_value, 2),
                'volatility_level': 'high' if bb_width > 0.1 else 'low'
            },
            'volume': {
                'current': int(latest_volume),
                'avg_20d': int(avg_volume_20),
                'ratio': round(volume_ratio, 2),
                'obv': int(obv_value),
                'signal': 'high' if volume_ratio > 1.5 else 'normal' if volume_ratio > 0.7 else 'low'
            },
            'signals': signals,
            'overall_score': _calculate_overall_score(signals)
        }
        
    except Exception as e:
        print(f"[INDICATORS] Error calculating indicators: {e}")
        return _get_fallback_indicators()

def _rsi_signal(rsi: float) -> str:
    """Generate signal from RSI"""
    if rsi > 70:
        return 'overbought'
    elif rsi < 30:
        return 'oversold'
    elif rsi > 50:
        return 'bullish'
    else:
        return 'bearish'

def _stoch_signal(k: float, d: float) -> str:
    """Generate signal from Stochastic"""
    if k > 80 and d > 80:
        return 'overbought'
    elif k < 20 and d < 20:
        return 'oversold'
    elif k > d:
        return 'bullish_cross'
    else:
        return 'bearish_cross'

def _generate_signals(rsi, macd_hist, bb_pos, stoch_k, price, sma20, sma50, vol_ratio) -> Dict:
    """Generate trading signals from indicators"""
    
    signals = []
    
    # RSI signals
    if rsi < 30:
        signals.append({'type': 'buy', 'indicator': 'RSI', 'strength': 'strong', 'message': 'Oversold condition'})
    elif rsi > 70:
        signals.append({'type': 'sell', 'indicator': 'RSI', 'strength': 'strong', 'message': 'Overbought condition'})
    
    # MACD signals
    if macd_hist > 0:
        signals.append({'type': 'buy', 'indicator': 'MACD', 'strength': 'medium', 'message': 'Bullish momentum'})
    else:
        signals.append({'type': 'sell', 'indicator': 'MACD', 'strength': 'medium', 'message': 'Bearish momentum'})
    
    # Bollinger Bands signals
    if bb_pos < 0.2:
        signals.append({'type': 'buy', 'indicator': 'BB', 'strength': 'medium', 'message': 'Near lower band'})
    elif bb_pos > 0.8:
        signals.append({'type': 'sell', 'indicator': 'BB', 'strength': 'medium', 'message': 'Near upper band'})
    
    # Moving Average signals
    if price > sma20 > sma50:
        signals.append({'type': 'buy', 'indicator': 'MA', 'strength': 'strong', 'message': 'Uptrend confirmed'})
    elif price < sma20 < sma50:
        signals.append({'type': 'sell', 'indicator': 'MA', 'strength': 'strong', 'message': 'Downtrend confirmed'})
    
    # Volume confirmation
    if vol_ratio > 1.5:
        signals.append({'type': 'neutral', 'indicator': 'Volume', 'strength': 'medium', 'message': 'High volume - confirmation'})
    
    return signals

def _calculate_overall_score(signals) -> Dict:
    """Calculate overall bullish/bearish score"""
    
    buy_score = 0
    sell_score = 0
    
    for signal in signals:
        weight = 2 if signal['strength'] == 'strong' else 1
        if signal['type'] == 'buy':
            buy_score += weight
        elif signal['type'] == 'sell':
            sell_score += weight
    
    total = buy_score + sell_score
    if total == 0:
        return {'sentiment': 'neutral', 'score': 50, 'confidence': 'low'}
    
    buy_pct = (buy_score / total) * 100
    
    if buy_pct > 65:
        sentiment = 'bullish'
        confidence = 'high' if buy_pct > 80 else 'medium'
    elif buy_pct < 35:
        sentiment = 'bearish'
        confidence = 'high' if buy_pct < 20 else 'medium'
    else:
        sentiment = 'neutral'
        confidence = 'low'
    
    return {
        'sentiment': sentiment,
        'score': round(buy_pct, 1),
        'confidence': confidence,
        'buy_signals': len([s for s in signals if s['type'] == 'buy']),
        'sell_signals': len([s for s in signals if s['type'] == 'sell'])
    }

def _get_fallback_indicators() -> Dict:
    """Return fallback indicators when calculation fails"""
    return {
        'price': {'current': 0, 'change': 0, 'change_pct': 0},
        'momentum': {'rsi': 50, 'rsi_signal': 'neutral'},
        'trend': {'macd_trend': 'neutral', 'trend': 'neutral'},
        'volatility': {'volatility_level': 'normal'},
        'volume': {'signal': 'normal'},
        'signals': [],
        'overall_score': {'sentiment': 'neutral', 'score': 50, 'confidence': 'low'}
    }
