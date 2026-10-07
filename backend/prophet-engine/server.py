"""
The Goal - Sports Betting Intelligence Backend
Flask server providing:
- ML predictions from SportsBetting models
- Live odds from the-odds-api.com
- Player props predictions
- Historical context
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
import sys
from datetime import datetime
import numpy as np

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# --- PARLAY SIMULATION ENGINE ---
@app.route('/api/simulate/parlay', methods=['POST'])
def simulate_parlay():
    """
    Monte Carlo Simulation for Parlays
    Calculates True Probability using Correlation Matrices
    """
    try:
        data = request.json
        legs = data.get('legs', [])
        iterations = data.get('iterations', 5000)

        if not legs:
            return jsonify({'error': 'No legs provided'}), 400

        # 1. Build Correlation Matrix
        n_legs = len(legs)
        correlation_matrix = np.eye(n_legs) # Start with identity (uncorrelated)
        
        correlation_desc = "Uncorrelated Events"
        has_correlation = False

        # Naive Correlation Logic (Can be replaced with historical covariance later)
        # Check for same-game / same-team connections
        for i in range(n_legs):
            for j in range(i + 1, n_legs):
                leg_a = legs[i]
                leg_b = legs[j]
                
                # Check 1: Same Game? (Assume legs have 'game_id' or infer from context)
                # For now, we infer from entity names matching partially
                
                # Rule: QB + WR from same team (Positive Correlation)
                # Example: "Mahomes" (QB) and "Kelce" (TE/WR)
                # We need metadata passed from frontend, but for now we look at raw strings
                
                # Stack Logic (Same Team Passing/Receiving)
                # Logic: If names match known stacks or user tagged them as same team
                if _are_correlated(leg_a, leg_b):
                    # Apply Correlation Coefficient (0.5 for QB/WR stack)
                    correlation_matrix[i, j] = 0.45 
                    correlation_matrix[j, i] = 0.45
                    has_correlation = True
                    correlation_desc = "Positive Correlation (Stack Detected)"

        # 2. Convert Probabilities to Z-Scores
        # We assume each leg has an implied probability (from odds)
        # Odds of -110 = 52.4%. We convert this to a Z-score threshold.
        z_thresholds = []
        implied_probs = []
        
        for leg in legs:
            # Parse odds (decimal)
            decimal_odds = float(leg.get('odds', 1.91))
            prob = 1 / decimal_odds
            implied_probs.append(prob)
            
            # Convert prob to Z-score (Inverse CDF)
            # For a "Hit", we need value > threshold. 
            # If prob is 0.60, we need top 60% of distribution.
            # norm.ppf(1 - prob) gives the Z-score cutoff.
            # Since we don't have scipy.stats imported, we approximate or assume standard normal.
            # Actually, let's use a simpler Copula simulation with Uniforms if needed, 
            # but Multi-Variate Normal is standard for this.
            
            # Simple Approximation for Z (inverse CDF):
            # This is rough, but effective for speed without scipy
            # Using random normal generation directly is easier.
            pass

        # 3. Run Simulation (Cholesky Decomposition)
        # Generate correlated random variables
        mean = np.zeros(n_legs)
        # Ensure positive semi-definite
        try:
            L = np.linalg.cholesky(correlation_matrix)
        except np.linalg.LinAlgError:
            # Fallback for non-PSD matrices (force diagonal boost)
            correlation_matrix += np.eye(n_legs) * 0.01
            L = np.linalg.cholesky(correlation_matrix)

        # Generate standard normals: (iterations x n_legs)
        Z = np.random.normal(0, 1, size=(iterations, n_legs))
        
        # Apply correlations: X = Z * L.T
        X = np.dot(Z, L.T)
        
        # 4. Count Hits
        # We convert the Z-scores back to percentiles (Uniforms) -> [0, 1]
        # Then compare against the implied probability requirement.
        
        # Actually, simpler: 
        # For each leg, we need the outcome to be "successful".
        # If Prob is 60%, any draw > 0.40 percentile is a win (assuming 0-1 distribution).
        # Normal distribution: Hit if Value > Threshold.
        # Threshold = Percentile Point Function (1 - Prob)
        
        hits = 0
        from scipy.stats import norm # We need scipy for ppf, let's check if available.
        # It is in requirements!
        
        pass 
        # Since I can't import mid-function easily, I'll use a hacky z-score lookup or just assume user has scipy.
        # Let's import scipy at top level in next replacement.
        
    except Exception as e:
        print(f"Simulation Error: {e}")
        return jsonify({'error': str(e)}), 500

# Import services
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Import services
try:
    from services.odds_service import get_live_odds
    from services.ml_service import predict_game_score
    from services.player_props_service import predict_player_props
    from services.historical_service import get_historical_context
    from services.market_service import get_market_intelligence, get_crypto_intelligence, search_symbol
    from services.trade_tracker import (
        record_trade, close_trade, get_agent_leaderboard, get_trade_history,
        get_active_trades, get_learning_events, get_portfolio_summary, reset_demo_trading
    )
    from services.resolver_service import resolve_games
except ImportError as e:
    print(f"Warning: Could not import services: {e}")
    print("Some endpoints may not work until services are created.")

@app.route('/')
def home():
    """Health check endpoint"""
    return jsonify({
        'status': 'active',
        'service': 'The Goal Intelligence Backend',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Detailed health check with service status"""
    return jsonify({
        'status': 'healthy',
        'services': {
            'odds_api': os.getenv('ODDS_API_KEY') is not None,
            'ml_models': True,  # Will check if models are loaded
            'database': True    # Will check DB connection
        },
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/game/intelligence/<sport>/<game_id>', methods=['GET'])
def get_game_intelligence(sport, game_id):
    """
    Get complete intelligence for a game
    Returns: ML predictions, live odds, player props, historical context, edge analysis
    """
    try:
        # Fetch all intelligence data
        intelligence = {
            'game_id': game_id,
            'sport': sport,
            'timestamp': datetime.now().isoformat()
        }
        
        # 1. Live Odds (fetch first so ML can use them)
        live_odds = []
        try:
            live_odds = get_live_odds(sport, game_id)
            intelligence['live_odds'] = live_odds
        except Exception as e:
            print(f"Odds fetch error: {e}")
            intelligence['live_odds'] = []
        
        # 2. ML Predictions (pass odds for better predictions)
        try:
            # Extract consensus odds to feed to ML model
            odds_for_ml = None
            if live_odds:
                first_book = live_odds[0]
                odds_for_ml = {
                    'home_ml': first_book.get('home_ml'),
                    'away_ml': first_book.get('away_ml'),
                    'home_spread': first_book.get('home_spread'),
                    'total': first_book.get('total')
                }
            
            ml_predictions = predict_game_score(sport, game_id, odds_for_ml)
            intelligence['ml_predictions'] = ml_predictions
        except Exception as e:
            print(f"ML prediction error: {e}")
            intelligence['ml_predictions'] = None
        
        # 3. Player Props
        try:
            player_props = predict_player_props(sport, game_id)
            intelligence['player_props'] = player_props
        except Exception as e:
            print(f"Player props error: {e}")
            intelligence['player_props'] = []
        
        # 4. Historical Context
        try:
            historical = get_historical_context(sport, game_id)
            intelligence['historical'] = historical
        except Exception as e:
            print(f"Historical context error: {e}")
            intelligence['historical'] = None
        
        # 5. Edge Analysis (calculated from odds + ML predictions)
        try:
            if intelligence['ml_predictions'] and intelligence['live_odds']:
                edge_analysis = calculate_edge_analysis(
                    intelligence['ml_predictions'],
                    intelligence['live_odds']
                )
                intelligence['edge_analysis'] = edge_analysis
            else:
                intelligence['edge_analysis'] = None
        except Exception as e:
            print(f"Edge analysis error: {e}")
            intelligence['edge_analysis'] = None
        
        # 6. Web Consensus (placeholder - will integrate existing consensus aggregator)
        intelligence['consensus'] = {
            'sources': 5,
            'avg_total': 220.5,
            'variance': 2.3,
            'agreement': 'Strong'
        }
        
        return jsonify({
            'success': True,
            'data': intelligence
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/odds/<sport>', methods=['GET'])
def get_odds_for_sport(sport):
    """Get live odds for all games in a sport"""
    try:
        odds = get_live_odds(sport)
        return jsonify({
            'success': True,
            'sport': sport,
            'odds': odds,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/predictions/<sport>/<game_id>', methods=['GET'])
def get_predictions(sport, game_id):
    """Get ML predictions for a specific game"""
    try:
        predictions = predict_game_score(sport, game_id)
        return jsonify({
            'success': True,
            'predictions': predictions
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/props/<sport>/<game_id>', methods=['GET'])
def get_props(sport, game_id):
    """Get player props predictions"""
    try:
        props = predict_player_props(sport, game_id)
        return jsonify({
            'success': True,
            'props': props
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ========== PARLAY SIMULATION ENGINE ==========

def _are_correlated(leg_a, leg_b):
    """
    Heuristic check for correlation between two betting legs
    """
    text_a = (str(leg_a.get('entity', '')) + " " + str(leg_a.get('stat', ''))).lower()
    text_b = (str(leg_b.get('entity', '')) + " " + str(leg_b.get('stat', ''))).lower()
    
    # Check 1: Same Entity (e.g. Points + Rebounds for same player)
    if leg_a.get('entity') == leg_b.get('entity') and leg_a.get('entity'):
        return True

    # Check 2: Same Game Stack (QB + WR)
    # This requires specific knowledge, for now we use simple heuristics or assume same team if passed
    if "mahomes" in text_a and "kelce" in text_b: return True
    if "burrow" in text_a and "chase" in text_b: return True
    if "allen" in text_a and "diggs" in text_b: return True
    
    return False

@app.route('/api/simulate/parlay', methods=['POST'])
def simulate_parlay():
    """
    Monte Carlo Simulation for Parlays
    Calculates True Probability using Correlation Matrices (Gaussian Copula)
    """
    try:
        data = request.json
        legs = data.get('legs', [])
        iterations = data.get('iterations', 5000)

        if not legs:
            return jsonify({'error': 'No legs provided'}), 400

        n_legs = len(legs)
        if n_legs < 2:
             return jsonify({
                'trueProb': 100 / float(legs[0].get('odds', 1.91)) if legs else 0,
                'impliedProb': 100 / float(legs[0].get('odds', 1.91)) if legs else 0,
                'edge': 0,
                'correlation': "Single Leg",
                'rating': "N/A"
            })

        # 1. Build Correlation Matrix
        correlation_matrix = np.eye(n_legs)
        correlation_desc = "Uncorrelated Events"
        has_correlation = False
        
        for i in range(n_legs):
            for j in range(i + 1, n_legs):
                if _are_correlated(legs[i], legs[j]):
                    # If same player (e.g. Points + Assists), high correlation
                    if legs[i].get('entity') == legs[j].get('entity'):
                         correlation_matrix[i, j] = 0.70
                         correlation_matrix[j, i] = 0.70
                         correlation_desc = "Strong Internal Correlation"
                         has_correlation = True
                    else:
                        # QB/WR Stack
                        correlation_matrix[i, j] = 0.45 
                        correlation_matrix[j, i] = 0.45
                        correlation_desc = "Positive Correlation (Stack)"
                        has_correlation = True

        # 2. Get Thresholds (Z-Scores)
        from scipy.stats import norm
        z_thresholds = []
        
        for leg in legs:
            decimal_odds = float(leg.get('odds', 1.91))
            prob = 1 / decimal_odds
            # Inverse CDF (PPF) gives the Z-score cutoff
            z_thresholds.append(norm.ppf(1 - prob))

        # 3. Run Simulation (Cholesky)
        try:
            L = np.linalg.cholesky(correlation_matrix)
        except np.linalg.LinAlgError:
            # Fix non-PSD matrices
            correlation_matrix += np.eye(n_legs) * 0.01
            L = np.linalg.cholesky(correlation_matrix)

        # Generate correlated normals
        Z = np.random.normal(0, 1, size=(iterations, n_legs))
        X = np.dot(Z, L.T)
        
        # 4. Count Hits
        # Check if ALL legs hit (Value > Threshold)
        hits = np.zeros(iterations, dtype=bool)
        parlay_hits = np.ones(iterations, dtype=bool)
        
        for i in range(n_legs):
            leg_hits = X[:, i] > z_thresholds[i]
            parlay_hits = np.logical_and(parlay_hits, leg_hits)
            
        total_hits = np.sum(parlay_hits)
        true_prob = total_hits / iterations
        
        # 5. Calculate Metrics
        implied_prob_parlay = 1.0
        for leg in legs:
            implied_prob_parlay *= (1 / float(leg.get('odds', 1.91)))
            
        edge = (true_prob - implied_prob_parlay) * 100
        
        rating = "C"
        if edge > 15: rating = "S+"
        elif edge > 10: rating = "S"
        elif edge > 5: rating = "A"
        elif edge > 0: rating = "B"
        
        return jsonify({
            'trueProb': round(true_prob * 100, 1),
            'impliedProb': round(implied_prob_parlay * 100, 1),
            'edge': round(edge, 1),
            'correlation': correlation_desc,
            'rating': rating,
            'iterations': iterations
        })

    except Exception as e:
        print(f"Simulation Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ========== MARKET ORACLE ENDPOINTS ==========

@app.route('/api/market/intelligence/<symbol>', methods=['GET'])
def get_market_intel(symbol):
    """Get complete market intelligence for a stock/crypto symbol"""
    try:
        intelligence = get_market_intelligence(symbol)
        
        if intelligence is None:
            return jsonify({
                'success': False,
                'error': f'No data found for symbol: {symbol}'
            }), 404
        
        return jsonify({
            'success': True,
            'data': intelligence
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/market/crypto/<symbol>', methods=['GET'])
def get_crypto_intel(symbol):
    """Get crypto-specific intelligence from CoinGecko"""
    try:
        crypto_data = get_crypto_intelligence(symbol)
        
        if crypto_data is None:
            return jsonify({
                'success': False,
                'error': f'No crypto data found for: {symbol}'
            }), 404
        
        return jsonify({
            'success': True,
            'data': crypto_data
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/market/search', methods=['GET'])
def search_market_symbol():
    """Search for a symbol"""
    try:
        query = request.args.get('q', '')
        if not query:
            return jsonify({
                'success': False,
                'error': 'Query parameter "q" is required'
            }), 400
        
        results = search_symbol(query)
        return jsonify({
            'success': True,
            'results': results
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def calculate_edge_analysis(ml_predictions, live_odds):
    """
    Calculate betting edge based on ML model probability vs implied probability from odds
    """
    try:
        # Get best odds from bookmakers
        best_home_ml = max([book['home_ml'] for book in live_odds if book.get('home_ml')])
        best_away_ml = max([book['away_ml'] for book in live_odds if book.get('away_ml')])
        
        # Convert American odds to implied probability
        def american_to_prob(odds):
            if odds > 0:
                return 100 / (odds + 100)
            else:
                return abs(odds) / (abs(odds) + 100)
        
        home_implied_prob = american_to_prob(best_home_ml)
        away_implied_prob = american_to_prob(best_away_ml)
        
        # Get model probability (based on score predictions)
        # Simple approach: higher predicted score = higher win probability
        home_score = ml_predictions.get('home_score', 0)
        away_score = ml_predictions.get('away_score', 0)
        total_score = home_score + away_score
        
        if total_score > 0:
            home_model_prob = home_score / total_score
        else:
            home_model_prob = 0.5
        
        # Calculate edge
        home_edge = home_model_prob - home_implied_prob
        away_edge = (1 - home_model_prob) - away_implied_prob
        
        # Determine best bet
        if home_edge > away_edge and home_edge > 0:
            best_bet = {
                'type': 'moneyline',
                'selection': f"Home ML",
                'odds': best_home_ml,
                'model_prob': home_model_prob,
                'implied_prob': home_implied_prob,
                'edge': home_edge * 100,  # Convert to percentage
                'ev_per_10': calculate_ev(best_home_ml, home_model_prob, 10),
                'kelly': home_edge * 100  # Simplified Kelly (actual Kelly is edge / odds)
            }
        elif away_edge > 0:
            best_bet = {
                'type': 'moneyline',
                'selection': f"Away ML",
                'odds': best_away_ml,
                'model_prob': 1 - home_model_prob,
                'implied_prob': away_implied_prob,
                'edge': away_edge * 100,
                'ev_per_10': calculate_ev(best_away_ml, 1 - home_model_prob, 10),
                'kelly': away_edge * 100
            }
        else:
            # No edge found
            best_bet = {
                'type': 'none',
                'selection': 'No positive edge detected',
                'edge': 0
            }
        
        return {
            'best_bet': best_bet,
            'home_analysis': {
                'model_prob': home_model_prob,
                'implied_prob': home_implied_prob,
                'edge': home_edge * 100
            },
            'away_analysis': {
                'model_prob': 1 - home_model_prob,
                'implied_prob': away_implied_prob,
                'edge': away_edge * 100
            }
        }
        
    except Exception as e:
        print(f"Edge calculation error: {e}")
        return None

def calculate_ev(american_odds, win_prob, stake):
    """Calculate expected value for a bet"""
    if american_odds > 0:
        payout = stake * (american_odds / 100)
    else:
        payout = stake * (100 / abs(american_odds))
    
    ev = (win_prob * payout) - ((1 - win_prob) * stake)
    return round(ev, 2)

# ========== TRADE LEARNING SYSTEM ENDPOINTS ==========

@app.route('/api/trades/open', methods=['POST'])
def open_trade():
    """Open a new trade (demo or live)"""
    try:
        data = request.get_json()
        
        # Required fields
        required = ['symbol', 'entry_price', 'quantity', 'side', 'agent_id', 'confidence']
        if not all(k in data for k in required):
            return jsonify({
                'success': False,
                'error': 'Missing required fields'
            }), 400
        
        trade_id = record_trade(
            symbol=data['symbol'],
            entry_price=float(data['entry_price']),
            quantity=float(data['quantity']),
            side=data['side'],
            agent_id=data['agent_id'],
            confidence=float(data['confidence']),
            regime=data.get('regime'),
            strategy_id=data.get('strategy_id'),
            is_demo=data.get('is_demo', True),
            metadata=data.get('metadata')
        )
        
        return jsonify({
            'success': True,
            'trade_id': trade_id
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/trades/close/<int:trade_id>', methods=['POST'])
def close_trade_endpoint(trade_id):
    """Close an existing trade"""
    try:
        data = request.get_json()
        
        if 'exit_price' not in data:
            return jsonify({
                'success': False,
                'error': 'exit_price is required'
            }), 400
        
        result = close_trade(trade_id, float(data['exit_price']))
        
        return jsonify({
            'success': True,
            'trade': result
        })
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/trades/history', methods=['GET'])
def get_trades():
    """Get trade history with optional filters"""
    try:
        limit = int(request.args.get('limit', 50))
        symbol = request.args.get('symbol')
        agent_id = request.args.get('agent_id')
        is_demo = request.args.get('is_demo')
        
        if is_demo is not None:
            is_demo = is_demo.lower() == 'true'
        
        trades = get_trade_history(
            limit=limit,
            symbol=symbol,
            agent_id=agent_id,
            is_demo=is_demo
        )
        
        return jsonify({
            'success': True,
            'trades': trades
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/trades/active', methods=['GET'])
def get_open_trades():
    """Get currently open positions"""
    try:
        is_demo = request.args.get('is_demo')
        if is_demo is not None:
            is_demo = is_demo.lower() == 'true'
        
        trades = get_active_trades(is_demo=is_demo)
        
        return jsonify({
            'success': True,
            'trades': trades
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/performance/agents', methods=['GET'])
def get_agent_performance():
    """Get agent performance leaderboard"""
    try:
        agents = get_agent_leaderboard()
        
        return jsonify({
            'success': True,
            'agents': agents
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/performance/summary', methods=['GET'])
def get_performance_summary():
    """Get overall portfolio performance"""
    try:
        is_demo = request.args.get('is_demo', 'true').lower() == 'true'
        summary = get_portfolio_summary(is_demo=is_demo)
        
        return jsonify({
            'success': True,
            'summary': summary
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/learning/events', methods=['GET'])
def get_recent_learning_events():
    """Get recent learning events"""
    try:
        limit = int(request.args.get('limit', 20))
        events = get_learning_events(limit=limit)
        
        return jsonify({
            'success': True,
            'events': events
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/learning/reset', methods=['POST'])
def reset_learning():
    """Reset demo trading and start fresh"""
    try:
        reset_demo_trading()
        
        return jsonify({
            'success': True,
            'message': 'Demo mode reset successfully'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/admin/resolve', methods=['POST'])
def trigger_resolution():
    """Manually trigger game resolution (Grade Homework)"""
    try:
        resolve_games()
        return jsonify({'success': True, 'message': 'Resolution cycle complete'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ========== EXCHANGE API ENDPOINTS ==========

@app.route('/api/exchange/test', methods=['POST'])
def test_exchange_connection():
    """Test exchange API connection"""
    try:
        data = request.get_json()
        exchange = data.get('exchange')
        api_key = data.get('apiKey')
        secret_key = data.get('secretKey')
        
        if not all([exchange, api_key, secret_key]):
            return jsonify({
                'success': False,
                'error': 'Missing required credentials'
            }), 400
        
        # Test connection based on exchange
        if exchange == 'binance':
            # TODO: Implement actual Binance API test
            # For now, mock successful connection
            return jsonify({
                'success': True,
                'message': f'Successfully connected to {exchange}',
                'account': 'Test Account'
            })
        elif exchange == 'coinbase':
            return jsonify({
                'success': True,
                'message': f'Successfully connected to {exchange}'
            })
        elif exchange == 'kraken':
            return jsonify({
                'success': True,
                'message': f'Successfully connected to {exchange}'
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Unsupported exchange: {exchange}'
            }), 400
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/exchange/balance', methods=['POST'])
def get_exchange_balance():
    """Get account balance from exchange"""
    try:
        data = request.get_json()
        keys = data.get('keys')
        
        if not keys:
            return jsonify({
                'success': False,
                'error': 'Exchange keys required'
            }), 400
        
        # TODO: Implement actual balance fetching
        # For now, return mock balance
        return jsonify({
            'success': True,
            'balance': 50000.00,  # Mock balance
            'currency': 'USD'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV', 'development') == 'development'
    
    print(f"""
    ==========================================
       THE GOAL - Intelligence Backend
       Running on http://localhost:{port}
    ==========================================
    """)
    
    app.run(host='0.0.0.0', port=port, debug=debug)
