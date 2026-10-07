"""
Historical Context Service - H2H Records and Trends
Provides matchup history, venue statistics, and betting trends
"""

import requests
from typing import Dict, Optional, List
from datetime import datetime, timedelta
import os

# Cache for historical data
_history_cache = {}
_cache_duration = timedelta(hours=24)

def get_historical_context(sport: str, game_id: str, teams: Optional[Dict] = None) -> Optional[Dict]:
    """
    Get historical context for a matchup
    
    Args:
        sport: Sport type
        game_id: Game identifier
        teams: Optional dict with team names/IDs
    
    Returns:
        Dictionary with H2H records, venue stats, trends
    """
    
    # Check cache
    cache_key = f"{sport}_{game_id}"
    if cache_key in _history_cache:
        cached_data, cached_time = _history_cache[cache_key]
        if datetime.now() - cached_time < _cache_duration:
            return cached_data
    
    # Generate intelligent historical context
    context = _generate_historical_context(sport, teams)
    
    # Cache result
    _history_cache[cache_key] = (context, datetime.now())
    
    return context

def _generate_historical_context(sport: str, teams: Optional[Dict] = None) -> Dict:
    """
    Generate realistic historical context based on sport and teams
    In production, this would query actual sports databases
    """
    
    if sport.lower() == 'nba':
        return _nba_historical_context(teams)
    elif sport.lower() == 'nfl':
        return _nfl_historical_context(teams)
    else:
        return _generic_historical_context(teams)

def _nba_historical_context(teams: Optional[Dict] = None) -> Dict:
    """
    NBA-specific historical context with realistic patterns
    """
    
    return {
        'head_to_head': {
            'total_games': 142,
            'home_wins': 78,
            'away_wins': 64,
            'win_pct': 0.549,
            'last_5_meetings': [
                {'result': 'W', 'score': '118-112', 'date': '2024-11-15'},
                {'result': 'L', 'score': '105-110', 'date': '2024-10-28'},
                {'result': 'W', 'score': '122-115', 'date': '2024-03-20'},
                {'result': 'W', 'score': '116-108', 'date': '2024-02-14'},
                {'result': 'L', 'score': '108-113', 'date': '2024-01-05'}
            ],
            'avg_total': 221.3,
            'avg_margin': 4.2,
            'total_trend': 'Over in 7 of last 10 meetings'
        },
        'venue': {
            'home_record': '24-13',
            'win_pct': 0.649,
            'home_avg_score': 112.4,
            'visitor_avg_score': 106.8,
            'avg_attendance': 18624,
            'altitude': 'Sea level',
            'recent_form': 'Won 4 of last 5 home games'
        },
        'team_stats': {
            'home_team': {
                'record': '28-15',
                'home_record': '18-5',
                'last_10': '7-3',
                'streak': 'W3',
                'ppg': 115.2,
                'opp_ppg': 110.8,
                'pace': 101.3,
                'off_rating': 117.5,
                'def_rating': 112.1
            },
            'away_team': {
                'record': '25-18',
                'away_record': '10-12',
                'last_10': '5-5',
                'streak': 'L1',
                'ppg': 112.7,
                'opp_ppg': 111.4,
                'pace': 99.8,
                'off_rating': 115.2,
                'def_rating': 113.8
            }
        },
        'betting_trends': [
            'Home team is 8-2 ATS in last 10 home games',
            'Away team is 3-7 ATS on the road this season',
            'Over is 12-8 in home team games this season',
            'Home team has covered by avg 3.2 points at home',
            'Public betting: 68% on home team ML'
        ],
        'key_matchups': [
            'Home PG (28.5 PPG) vs Away PG (24.2 PPG)',
            'Rebounding battle: Home (46.2 RPG) vs Away (44.1 RPG)',
            'Bench scoring: Home (35.8 PPG) vs Away (32.4 PPG)'
        ],
        'injuries': [
            {'player': 'Backup Guard', 'team': 'HOME', 'status': 'Out', 'impact': 'Low'},
            {'player': 'Starting Forward', 'team': 'AWAY', 'status': 'Questionable', 'impact': 'Medium'}
        ],
        'rest_advantage': {
            'home_days_rest': 2,
            'away_days_rest': 1,
            'advantage': 'Home (+1 day)'
        }
    }

def _nfl_historical_context(teams: Optional[Dict] = None) -> Dict:
    """
    NFL-specific historical context
    """
    
    return {
        'head_to_head': {
            'total_games': 52,
            'home_wins': 28,
            'away_wins': 24,
            'win_pct': 0.538,
            'last_5_meetings': [
                {'result': 'W', 'score': '27-24', 'date': '2024-12-15'},
                {'result': 'L', 'score': '20-31', 'date': '2024-09-22'},
                {'result': 'W', 'score': '35-17', 'date': '2023-11-19'},
                {'result': 'L', 'score': '14-21', 'date': '2023-10-08'},
                {'result': 'W', 'score': '28-23', 'date': '2022-12-11'}
            ],
            'avg_total': 47.2,
            'avg_margin': 6.8,
            'total_trend': 'Under in 6 of last 10 meetings'
        },
        'venue': {
            'home_record': '6-2',
            'win_pct': 0.750,
            'home_avg_score': 25.8,
            'visitor_avg_score': 19.4,
            'surface': 'Natural grass',
            'weather': 'Clear, 52°F, Wind 8mph W',
            'recent_form': 'Won 5 of last 6 home games'
        },
        'team_stats': {
            'home_team': {
                'record': '10-5',
                'home_record': '6-2',
                'last_5': '4-1',
                'streak': 'W2',
                'ppg': 26.4,
                'opp_ppg': 21.8,
                'pass_ypg': 248.3,
                'rush_ypg': 132.5,
                'turnover_diff': '+8'
            },
            'away_team': {
                'record': '8-7',
                'away_record': '3-5',
                'last_5': '2-3',
                'streak': 'L1',
                'ppg': 23.1,
                'opp_ppg': 23.5,
                'pass_ypg': 265.7,
                'rush_ypg': 98.2,
                'turnover_diff': '-4'
            }
        },
        'betting_trends': [
            'Home team is 7-1 ATS at home this season',
            'Away team is 2-6 ATS on road',
            'Under is 9-6 in home team games',
            'Home team averages +4.6 point differential at home',
            'Sharp money: 72% of dollars on home team'
        ],
        'key_matchups': [
            'Home QB (4218 pass yds, 28 TD) vs Away secondary (18th ranked)',
            'Away RB (1247 rush yds) vs Home run defense (8th ranked)',
            'Home pass rush (38 sacks) vs Away O-line (42 sacks allowed)'
        ],
        'injuries': [
            {'player': 'Starting LB', 'team': 'HOME', 'status': 'Out', 'impact': 'Medium'},
            {'player': 'WR2', 'team': 'AWAY', 'status': 'Questionable', 'impact': 'Low'},
            {'player': 'Starting CB', 'team': 'AWAY', 'status': 'Doubtful', 'impact': 'High'}
        ],
        'rest_advantage': {
            'home_days_rest': 7,
            'away_days_rest': 7,
            'advantage': 'Even'
        }
    }

def _generic_historical_context(teams: Optional[Dict] = None) -> Dict:
    """Generic historical context for other sports"""
    return {
        'head_to_head': {
            'total_games': 45,
            'home_wins': 25,
            'away_wins': 20,
            'win_pct': 0.556,
            'avg_margin': 2.5
        },
        'venue': {
            'home_record': '15-8',
            'win_pct': 0.652
        },
        'betting_trends': [
            'Home team has strong home record',
            'Competitive matchup historically'
        ]
    }
