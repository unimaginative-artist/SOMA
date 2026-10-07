# The Goal - Intelligence Backend

Sports betting intelligence backend with ML predictions, live odds, and edge analysis.

## Quick Start

### 1. Install Dependencies

```bash
cd backend/forecaster-ml
pip install -r requirements.txt
```

### 2. Set Up Environment Variables

Create `.env` file:

```env
# The Odds API (sign up at https://the-odds-api.com)
ODDS_API_KEY=your_api_key_here

# Flask Configuration
FLASK_ENV=development
PORT=5000

# Optional: Database
DATABASE_URL=sqlite:///data/forecaster.db
```

### 3. Get Free API Key

1. Go to https://the-odds-api.com
2. Click "Get API Key"
3. Sign up (FREE tier: 500 requests/month)
4. Copy your API key to `.env`

### 4. Run the Server

```bash
python server.py
```

Server runs on `http://localhost:5000`

## API Endpoints

### Game Intelligence
```
GET /api/game/intelligence/<sport>/<game_id>
```
Returns: ML predictions, live odds, player props, edge analysis, consensus

**Example:**
```
GET http://localhost:5000/api/game/intelligence/nba/mock_game_1
```

### Live Odds
```
GET /api/odds/<sport>
```
Returns: Live odds from FanDuel, DraftKings, BetMGM, etc.

**Sports:**
- `nba` - Basketball
- `nfl` - Football  
- `nhl` - Hockey
- `mlb` - Baseball

### ML Predictions
```
GET /api/predictions/<sport>/<game_id>
```
Returns: Score predictions with confidence intervals

### Player Props
```
GET /api/props/<sport>/<game_id>
```
Returns: Individual player stat predictions

### Health Check
```
GET /api/health
```
Returns: Service status and API availability

## Architecture

```
backend/forecaster-ml/
├── server.py                  # Flask app with endpoints
├── services/
│   ├── odds_service.py        # the-odds-api.com integration
│   ├── ml_service.py          # ML predictions (SportsBetting models)
│   ├── player_props_service.py # Player stat predictions
│   └── historical_service.py  # H2H records, venue stats
├── models/
│   ├── nba_model.pkl          # Trained NBA model
│   └── nfl_model.pkl          # Trained NFL model
└── data/
    └── cache/                 # Cached historical data
```

## Features

### ✅ Live Odds
- **Bookmakers**: FanDuel, DraftKings, BetMGM, Caesars
- **Markets**: Moneylines, Spreads, Totals (Over/Under)
- **Cache**: 5-minute TTL to conserve API credits
- **Fallback**: Mock data if API unavailable

### ✅ ML Predictions
- **Models**: Polynomial Regression (from SportsBetting repo)
- **Outputs**: Home/Away scores, confidence intervals
- **Sports**: NBA, NFL (NHL, MLB coming soon)

### ✅ Edge Detection
- **Calculation**: Model probability vs Implied probability
- **Metrics**: Edge %, Expected Value, Kelly Criterion
- **Best Bet**: Automatically identifies highest-edge opportunities

### ✅ Player Props
- **Stats**: Points, Assists, Rebounds, Yards, Touchdowns
- **Method**: Season averages + recent form + matchup context
- **Confidence**: Based on games played and variance

### ✅ Historical Context
- Head-to-head records
- Venue statistics (home/away performance)
- Recent meetings
- Rest days analysis

## Energy-Efficient Loading

**Frontend only loads data when "The Goal" tab is clicked:**

```javascript
// In TheGoalView.jsx
useEffect(() => {
    if (activeTab === 'goal' && selectedGame) {
        loadGameIntelligence(selectedGame);
    }
}, [activeTab, selectedGame]);
```

**Backend caching prevents excessive API calls:**
- Odds cached for 5 minutes
- Historical data cached for 24 hours
- ML models loaded once at startup

## Development

### Test Odds Service
```bash
python services/odds_service.py
```

### Test with Mock Data
Backend automatically uses mock data if `ODDS_API_KEY` not set.

### Monitor API Usage
the-odds-api.com dashboard shows remaining credits.

## Production Checklist

- [ ] Set `FLASK_ENV=production`
- [ ] Get paid API plan if >500 requests/month
- [ ] Set up proper database (PostgreSQL)
- [ ] Add rate limiting
- [ ] Enable HTTPS
- [ ] Set up monitoring (Sentry, Datadog)
- [ ] Configure CORS for production domain

## Troubleshooting

**"ODDS_API_KEY not set"**
- Add your API key to `.env` file
- Server will use mock data as fallback

**"Module not found" errors**
- Run `pip install -r requirements.txt`
- Make sure you're in the right directory

**Odds not updating**
- Check API key is valid
- Verify API credits remaining
- Clear cache: restart server

**CORS errors from frontend**
- Flask-CORS is enabled by default
- Check frontend is calling correct port (5000)

## Next Steps

1. **Sign up for the-odds-api.com** (free tier)
2. **Add API key to `.env`**
3. **Run `python server.py`**
4. **Open The Goal tab** in frontend
5. **Watch live odds flow in!** 🎯

---

Built for SOMA Command Bridge
