"""
ML Service - Game Score Predictions
Adapted from SportsBetting NBAModel.py
Uses Polynomial Regression trained on historical odds and scores
"""

import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures
from sklearn.pipeline import make_pipeline
import os
import pickle
import sqlite3
from typing import Dict, Optional
from datetime import datetime

# DB Path for Learning
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'trades.db')

# Cache for loaded models
_model_cache = {}

class MLPredictor:
    """ML predictor based on SportsBetting approach"""
    
    def __init__(self, sport='nba'):
        self.sport = sport
        self.model = None
        self.model_loaded = False
        self.bias = {'home': 0.0, 'away': 0.0, 'total': 0.0} # Learned adjustments
        
    def _learn_from_history(self):
        """
        SELF-CORRECTION: Read past errors from DB and update bias.
        """
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            
            # Find closed trades where we have metadata about the prediction
            # Ideally, resolver_service logs specific 'prediction_error' events
            # For now, we infer from 'learning_events' if available, or just raw trade P&L
            
            # Simple Logic: If we are losing on 'Over' bets, we are over-predicting.
            # If we are losing on 'Under' bets, we are under-predicting.
            
            # Fetch recent closed trades
            c.execute('''
                SELECT side, pnl, metadata FROM trades 
                WHERE status = 'closed' AND is_demo = 1
                ORDER BY timestamp DESC LIMIT 50
            ''')
            trades = c.fetchall()
            conn.close()
            
            bias_home = 0.0
            count = 0
            
            for side, pnl, meta_json in trades:
                # Naive Reinforcement Learning
                # If we bought 'Home' and lost (negative P&L), we likely overestimated Home.
                # Adjustment: Decrease Home prediction slightly.
                if pnl < 0:
                    if 'Home' in side or 'Over' in side:
                        bias_home -= 0.5 # Correction step
                    elif 'Away' in side or 'Under' in side:
                        bias_home += 0.5
                elif pnl > 0:
                    # We were right, reinforce (optional, or just do nothing)
                    pass
                count += 1
            
            # Apply decay/smoothing to avoid wild swings
            if count > 0:
                self.bias['home'] = bias_home / count # Average error direction
                print(f"[ML] 🧠 SELF-CORRECTING: Applying bias {self.bias['home']:.2f} to predictions based on {count} past trades.")
            
        except Exception as e:
            print(f"[ML] Learning failed: {e}")

    def load_or_create_model(self):
        """Load trained model or create simple baseline"""
        if self.model_loaded:
            return
        
        # Trigger learning before prediction
        self._learn_from_history()
        
        model_path = f'models/{self.sport}_model.pkl'
        
        # Try to load pre-trained model
        if os.path.exists(model_path):
            try:
                with open(model_path, 'rb') as f:
                    self.model = pickle.load(f)
                    print(f"[ML] Loaded {self.sport} model from {model_path}")
                    self.model_loaded = True
                    return
            except Exception as e:
                print(f"[ML] Failed to load model: {e}")
        
        # Create simple polynomial regression model
        # Features: Home ML, Away ML, Home Spread, Away Spread, Total
        # Targets: Home Score, Away Score
        degree = 1  # Linear for now (polynomial = 2 for better fit)
        self.model = make_pipeline(PolynomialFeatures(degree), LinearRegression())
        
        # Train on default NBA scoring patterns
        # This is a simplified baseline - in production, train on historical data
        self._train_baseline_model()
        
        self.model_loaded = True
    
    def _train_baseline_model(self):
        """Train a simple baseline model with typical NBA patterns"""
        # Simplified training data representing typical NBA games
        # Features: [home_ml, away_ml, home_spread, away_spread, total]
        X_train = np.array([
            [1.50, 2.60, -5.5, 5.5, 220],
            [1.45, 2.80, -6.5, 6.5, 215],
            [2.20, 1.65, 3.5, -3.5, 225],
            [1.80, 2.00, -2.5, 2.5, 218],
            [1.35, 3.20, -8.5, 8.5, 210],
        ])
        
        # Targets: [home_score, away_score]
        y_train = np.array([
            [115, 108],  # Home wins by 7
            [112, 105],  # Home wins by 7
            [108, 112],  # Away wins by 4
            [110, 108],  # Home wins by 2
            [118, 102],  # Home wins by 16
        ])
        
        self.model.fit(X_train, y_train)
        print(f"[ML] Trained baseline {self.sport} model")
    
    def predict_from_odds(self, odds_data: Dict) -> Dict:
        """Predict scores from betting odds"""
        self.load_or_create_model()
        
        try:
            # Extract features from odds data
            # Convert American odds to decimal
            home_ml = self._american_to_decimal(odds_data.get('home_ml', -150))
            away_ml = self._american_to_decimal(odds_data.get('away_ml', 130))
            home_spread = odds_data.get('home_spread', -4.5)
            away_spread = -home_spread
            total = odds_data.get('total', 220)
            
            # Create feature vector
            X = np.array([[home_ml, away_ml, home_spread, away_spread, total]])
            
            # Predict scores
            predictions = self.model.predict(X)[0]
            home_score = float(predictions[0]) + self.bias['home'] # Apply Learned Bias
            away_score = float(predictions[1]) + self.bias['away']
            
            # Calculate confidence based on spread
            # Smaller spread = lower confidence (closer game)
            spread_abs = abs(home_spread)
            confidence = min(0.95, 0.60 + (spread_abs / 20))
            
            # Calculate range (±1 standard deviation)
            # Higher spread = more certainty = tighter range
            std_dev = max(5, 15 - spread_abs)
            
            return {
                'model': 'Polynomial Regression (Odds-Based)',
                'home_score': round(home_score, 1),
                'away_score': round(away_score, 1),
                'confidence': round(confidence, 2),
                'range': {
                    'low': round(home_score - std_dev, 1),
                    'high': round(home_score + std_dev, 1)
                },
                'total_predicted': round(home_score + away_score, 1),
                'spread_predicted': round(home_score - away_score, 1),
                'method': 'ml_odds'
            }
            
        except Exception as e:
            print(f"[ML] Prediction error: {e}")
            return self._get_fallback_prediction(odds_data)
    
    def _american_to_decimal(self, american_odds):
        """Convert American odds to decimal format"""
        if american_odds > 0:
            return 1 + (american_odds / 100)
        else:
            return 1 + (100 / abs(american_odds))
    
    def _get_fallback_prediction(self, odds_data):
        """Simple fallback based on spread and total"""
        total = odds_data.get('total', 220)
        spread = odds_data.get('home_spread', -4.5)
        
        # Split total accounting for spread
        home_score = (total / 2) - (spread / 2)
        away_score = (total / 2) + (spread / 2)
        
        return {
            'model': 'Simple Spread Model (Fallback)',
            'home_score': round(home_score, 1),
            'away_score': round(away_score, 1),
            'confidence': 0.65,
            'range': {
                'low': round(home_score - 10, 1),
                'high': round(home_score + 10, 1)
            },
            'total_predicted': round(total, 1),
            'spread_predicted': round(spread, 1),
            'method': 'fallback'
        }

# Global predictor instance
_nba_predictor = None
_nfl_predictor = None

def predict_game_score(sport: str, game_id: str, odds_data: Optional[Dict] = None) -> Optional[Dict]:
    """
    Predict game score using ML models
    
    Args:
        sport: Sport type ('nba', 'nfl', 'nhl', 'mlb')
        game_id: Game identifier
        odds_data: Optional odds data to base prediction on
    
    Returns:
        Dictionary with home_score, away_score, confidence, range
    """
    global _nba_predictor, _nfl_predictor
    
    # Get or create predictor
    if sport.lower() == 'nba':
        if _nba_predictor is None:
            _nba_predictor = MLPredictor('nba')
        predictor = _nba_predictor
    elif sport.lower() == 'nfl':
        if _nfl_predictor is None:
            _nfl_predictor = MLPredictor('nfl')
        predictor = _nfl_predictor
    else:
        # Default to NBA predictor for other sports
        if _nba_predictor is None:
            _nba_predictor = MLPredictor('nba')
        predictor = _nba_predictor
    
    # If odds data provided, use it for prediction
    if odds_data:
        return predictor.predict_from_odds(odds_data)
    
    # Otherwise use mock odds (better than nothing)
    mock_odds = {
        'home_ml': -165,
        'away_ml': 140,
        'home_spread': -4.5,
        'total': 221
    }
    
    return predictor.predict_from_odds(mock_odds)
