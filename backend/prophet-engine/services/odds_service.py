"""
Odds Service - Integration with the-odds-api.com
Fetches live odds from multiple bookmakers
"""

import requests
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import json

# Cache for odds data (5-minute TTL)
_odds_cache = {}
_cache_ttl = timedelta(minutes=5)

def get_live_odds(sport: str, game_id: Optional[str] = None) -> List[Dict]:
    """
    Fetch live odds from the-odds-api.com
    
    Args:
        sport: Sport key ('basketball_nba', 'americanfootball_nfl', etc.)
        game_id: Optional specific game ID
    
    Returns:
        List of odds data from multiple bookmakers
    """
    api_key = os.getenv('ODDS_API_KEY')
    
    if not api_key:
        print("Warning: ODDS_API_KEY not set. Using mock data.")
        return _get_mock_odds(sport, game_id)
    
    # Check cache first
    cache_key = f"{sport}_{game_id or 'all'}"
    if cache_key in _odds_cache:
        cached_data, cached_time = _odds_cache[cache_key]
        if datetime.now() - cached_time < _cache_ttl:
            print(f"Using cached odds for {cache_key}")
            return cached_data
    
    try:
        # Map sport names to API keys
        sport_keys = {
            'nba': 'basketball_nba',
            'nfl': 'americanfootball_nfl',
            'nhl': 'icehockey_nhl',
            'mlb': 'baseball_mlb'
        }
        
        sport_key = sport_keys.get(sport.lower(), sport)
        
        # Build API URL
        url = f"https://api.the-odds-api.com/v4/sports/{sport_key}/odds/"
        
        params = {
            'apiKey': api_key,
            'regions': 'us',  # US bookmakers
            'markets': 'h2h,spreads,totals',  # Moneyline, spreads, totals
            'oddsFormat': 'american',  # American odds format
            'bookmakers': 'fanduel,draftkings,betmgm,williamhill_us'  # Major US books
        }
        
        print(f"Fetching odds from the-odds-api.com for {sport_key}...")
        response = requests.get(url, params=params, timeout=10)
        
        if response.status_code != 200:
            print(f"Odds API error: {response.status_code}")
            return _get_mock_odds(sport, game_id)
        
        data = response.json()
        
        # Transform API response to our format
        odds_data = _transform_odds_data(data, game_id)
        
        # Cache the results
        _odds_cache[cache_key] = (odds_data, datetime.now())
        
        print(f"Fetched {len(odds_data)} odds records from API")
        return odds_data
        
    except Exception as e:
        print(f"Error fetching odds: {e}")
        return _get_mock_odds(sport, game_id)

def _transform_odds_data(api_data: List[Dict], game_id: Optional[str] = None) -> List[Dict]:
    """Transform the-odds-api.com response to our format"""
    
    if not api_data:
        return []
    
    # If game_id specified, filter to that game
    if game_id:
        api_data = [g for g in api_data if g.get('id') == game_id]
    
    transformed = []
    
    for game in api_data:
        game_odds = {
            'game_id': game.get('id'),
            'home_team': game.get('home_team'),
            'away_team': game.get('away_team'),
            'commence_time': game.get('commence_time'),
            'bookmakers': []
        }
        
        # Extract odds from each bookmaker
        for bookmaker in game.get('bookmakers', []):
            book_data = {
                'bookmaker': bookmaker.get('title'),
                'last_update': bookmaker.get('last_update')
            }
            
            # Extract markets
            for market in bookmaker.get('markets', []):
                market_key = market.get('key')
                
                if market_key == 'h2h':  # Moneyline
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == game['home_team']:
                            book_data['home_ml'] = outcome['price']
                        else:
                            book_data['away_ml'] = outcome['price']
                
                elif market_key == 'spreads':  # Point spreads
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == game['home_team']:
                            book_data['home_spread'] = outcome['point']
                            book_data['home_spread_odds'] = outcome['price']
                        else:
                            book_data['away_spread'] = outcome['point']
                            book_data['away_spread_odds'] = outcome['price']
                
                elif market_key == 'totals':  # Over/Under
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == 'Over':
                            book_data['total'] = outcome['point']
                            book_data['over_odds'] = outcome['price']
                        else:
                            book_data['under_odds'] = outcome['price']
            
            game_odds['bookmakers'].append(book_data)
        
        transformed.append(game_odds)
    
    # Flatten to bookmaker-level records for easier consumption
    flattened = []
    for game_data in transformed:
        for book in game_data['bookmakers']:
            flattened.append({
                'game_id': game_data['game_id'],
                'home_team': game_data['home_team'],
                'away_team': game_data['away_team'],
                'bookmaker': book['bookmaker'],
                'home_ml': book.get('home_ml'),
                'away_ml': book.get('away_ml'),
                'spread': book.get('home_spread'),
                'spread_odds': book.get('home_spread_odds'),
                'total': book.get('total'),
                'over_odds': book.get('over_odds'),
                'under_odds': book.get('under_odds'),
                'last_update': book.get('last_update')
            })
    
    return flattened

def _get_mock_odds(sport: str, game_id: Optional[str] = None) -> List[Dict]:
    """Return mock odds data for development/fallback"""
    
    mock_data = [
        {
            'game_id': 'mock_game_1',
            'home_team': 'Lakers',
            'away_team': 'Celtics',
            'bookmaker': 'FanDuel',
            'home_ml': -165,
            'away_ml': 140,
            'spread': -4.5,
            'spread_odds': -110,
            'total': 221.0,
            'over_odds': -110,
            'under_odds': -110,
            'last_update': datetime.now().isoformat()
        },
        {
            'game_id': 'mock_game_1',
            'home_team': 'Lakers',
            'away_team': 'Celtics',
            'bookmaker': 'DraftKings',
            'home_ml': -170,
            'away_ml': 145,
            'spread': -4.5,
            'spread_odds': -108,
            'total': 220.5,
            'over_odds': -112,
            'under_odds': -108,
            'last_update': datetime.now().isoformat()
        },
        {
            'game_id': 'mock_game_1',
            'home_team': 'Lakers',
            'away_team': 'Celtics',
            'bookmaker': 'BetMGM',
            'home_ml': -162,
            'away_ml': 138,
            'spread': -4.0,
            'spread_odds': -110,
            'total': 221.5,
            'over_odds': -110,
            'under_odds': -110,
            'last_update': datetime.now().isoformat()
        }
    ]
    
    if game_id:
        return [odds for odds in mock_data if odds['game_id'] == game_id]
    
    return mock_data

def clear_odds_cache():
    """Clear the odds cache (useful for testing)"""
    global _odds_cache
    _odds_cache = {}
    print("Odds cache cleared")

if __name__ == '__main__':
    # Test the odds service
    print("Testing Odds Service...")
    print("=" * 50)
    
    # Test with mock data
    odds = get_live_odds('nba')
    print(f"\nFetched {len(odds)} odds records")
    
    if odds:
        print("\nSample odds:")
        print(json.dumps(odds[0], indent=2))
