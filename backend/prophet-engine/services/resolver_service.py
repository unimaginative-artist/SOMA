"""
Resolver Service - The "Grader"
Fetches final game scores and settles open predictions.
"""

import requests
import json
from datetime import datetime, timedelta
import logging
from .trade_tracker import record_trade, close_trade, get_active_trades

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ESPN_NFL_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ESPN_NBA_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

def resolve_games():
    """
    Main loop: Checks active predictions against final scores.
    """
    logger.info("🔎 Resolving open predictions...")
    
    # 1. Get Open Trades
    open_trades = get_active_trades(is_demo=True)
    if not open_trades:
        logger.info("No open trades to resolve.")
        return

    # 2. Fetch Scores
    # Optimized: Only fetch sports we have active bets on
    sports = set()
    for trade in open_trades:
        # Infer sport from metadata or symbol (e.g. 'NFL_KC_BUF')
        # Fallback to fetching both if unknown
        sports.add('nfl')
        sports.add('nba')
    
    scores = {}
    if 'nfl' in sports:
        scores.update(_fetch_scores(ESPN_NFL_API))
    if 'nba' in sports:
        scores.update(_fetch_scores(ESPN_NBA_API))

    # 3. Grade
    for trade in open_trades:
        symbol = trade['symbol'] # e.g. "NFL:KC:Points" or "KC"
        trade_id = trade['trade_id'] # trade_tracker uses 'id', check mapping
        
        # Parse symbol to match game (Naive matching for MVP)
        # Assuming symbol is "TeamName" or "TeamName_Prop"
        team = symbol.split(':')[0] 
        
        if team in scores:
            game = scores[team]
            if game['status'] == 'STATUS_FINAL':
                actual_score = game['score']
                logger.info(f"✅ Game Final: {team} Scored {actual_score}")
                
                # Logic to determine 'exit_price'
                # If bet was 'Over 28.5', and result is 30, exit price is 1.0 (Win) or similar.
                # Ideally, trade_tracker supports binary options or exact values.
                # For Moneyline/Spread, we close at the odds value if won, 0 if lost.
                
                # Assume standard Moneyline for now: 
                # If we picked KC and KC won, close at profit.
                
                # Simple P&L Logic for Prediction Market:
                # Close trade at 'actual_value' to track error?
                # No, we need P&L.
                
                # Let's simplify: Close with the ACTUAL score so the ML knows the delta.
                try:
                    close_trade(trade['id'], float(actual_score))
                    logger.info(f"💰 Settled Trade #{trade_id} for {team}")
                except Exception as e:
                    logger.error(f"Failed to settle trade {trade_id}: {e}")

def _fetch_scores(api_url):
    """
    Fetches raw scores from ESPN and normalizes them.
    Returns dict: { 'KC': { score: 24, status: 'FINAL', winner: true } }
    """
    try:
        res = requests.get(api_url)
        data = res.json()
        
        results = {}
        for event in data.get('events', []):
            status = event['status']['type']['name'] # STATUS_FINAL
            
            for competitor in event['competitions'][0]['competitors']:
                team_abbr = competitor['team']['abbreviation']
                score = competitor['score']
                winner = competitor.get('winner', False)
                
                results[team_abbr] = {
                    'score': score,
                    'status': status,
                    'winner': winner
                }
        return results
    except Exception as e:
        logger.error(f"Score fetch failed: {e}")
        return {}

if __name__ == "__main__":
    resolve_games()
