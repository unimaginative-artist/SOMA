"""
Trade Tracker - Performance Tracking & Learning System
Records all trades (demo and live) and tracks agent performance
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'trades.db')

def init_database():
    """Initialize SQLite database with schema"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Trades table
    c.execute('''CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        symbol TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL,
        quantity REAL NOT NULL,
        side TEXT NOT NULL,
        pnl REAL,
        pnl_pct REAL,
        agent_id TEXT NOT NULL,
        strategy_id TEXT,
        confidence REAL,
        regime TEXT,
        status TEXT NOT NULL,
        is_demo INTEGER NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT,
        metadata TEXT
    )''')
    
    # Agent performance table
    c.execute('''CREATE TABLE IF NOT EXISTS agent_performance (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        total_trades INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0.0,
        avg_pnl REAL DEFAULT 0.0,
        total_pnl REAL DEFAULT 0.0,
        sharpe_ratio REAL DEFAULT 0.0,
        max_drawdown REAL DEFAULT 0.0,
        current_allocation REAL DEFAULT 20.0,
        last_updated TEXT,
        is_active INTEGER DEFAULT 1
    )''')
    
    # Strategy performance table
    c.execute('''CREATE TABLE IF NOT EXISTS strategy_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        regime TEXT,
        performance_score REAL DEFAULT 0.0,
        allocation_weight REAL DEFAULT 1.0,
        trades_count INTEGER DEFAULT 0,
        last_updated TEXT,
        UNIQUE(strategy_id, symbol, regime)
    )''')
    
    # Market regimes table
    c.execute('''CREATE TABLE IF NOT EXISTS market_regimes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        symbol TEXT NOT NULL,
        regime TEXT NOT NULL,
        volatility REAL,
        confidence REAL,
        indicators TEXT
    )''')
    
    # Learning events table
    c.execute('''CREATE TABLE IF NOT EXISTS learning_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT,
        old_weight REAL,
        new_weight REAL,
        reason TEXT,
        metadata TEXT
    )''')
    
    conn.commit()
    conn.close()
    print(f"[TradeTracker] Database initialized at {DB_PATH}")

# Initialize on import
init_database()

def record_trade(
    symbol: str,
    entry_price: float,
    quantity: float,
    side: str,
    agent_id: str,
    confidence: float,
    regime: Optional[str] = None,
    strategy_id: Optional[str] = None,
    is_demo: bool = True,
    metadata: Optional[Dict] = None
) -> int:
    """
    Record a new trade entry
    
    Returns:
        trade_id: The ID of the created trade
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    now = datetime.now().isoformat()
    
    c.execute('''INSERT INTO trades 
        (timestamp, symbol, entry_price, quantity, side, agent_id, strategy_id,
         confidence, regime, status, is_demo, entry_time, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)''',
        (now, symbol, entry_price, quantity, side, agent_id, strategy_id,
         confidence, regime, 1 if is_demo else 0, now, json.dumps(metadata) if metadata else None))
    
    trade_id = c.lastrowid
    conn.commit()
    conn.close()
    
    print(f"[TradeTracker] {'DEMO' if is_demo else 'LIVE'} Trade opened: {trade_id} - {side} {quantity} {symbol} @ {entry_price}")
    return trade_id

def close_trade(trade_id: int, exit_price: float) -> Dict:
    """
    Close an open trade and calculate P&L
    
    Returns:
        Trade details with P&L
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get trade details
    c.execute('SELECT * FROM trades WHERE id = ? AND status = "open"', (trade_id,))
    row = c.fetchone()
    
    if not row:
        conn.close()
        raise ValueError(f"Trade {trade_id} not found or already closed")
    
    # Parse row
    cols = [desc[0] for desc in c.description]
    trade = dict(zip(cols, row))
    
    # Calculate P&L
    entry_price = trade['entry_price']
    quantity = trade['quantity']
    side = trade['side']
    
    if side.lower() == 'buy' or side.lower() == 'long':
        pnl = (exit_price - entry_price) * quantity
    else:  # short/sell
        pnl = (entry_price - exit_price) * quantity
    
    pnl_pct = (pnl / (entry_price * quantity)) * 100
    
    # Update trade
    exit_time = datetime.now().isoformat()
    c.execute('''UPDATE trades 
        SET exit_price = ?, pnl = ?, pnl_pct = ?, status = 'closed', exit_time = ?
        WHERE id = ?''',
        (exit_price, pnl, pnl_pct, exit_time, trade_id))
    
    conn.commit()
    conn.close()
    
    # Update agent performance
    update_agent_performance(trade['agent_id'])
    
    # Log learning event
    log_learning_event(
        event_type='trade_closed',
        agent_id=trade['agent_id'],
        reason=f"{'Win' if pnl > 0 else 'Loss'}: {trade['symbol']} P&L ${pnl:.2f}",
        metadata={'trade_id': trade_id, 'pnl': pnl, 'pnl_pct': pnl_pct}
    )
    
    print(f"[TradeTracker] Trade closed: {trade_id} - P&L: ${pnl:.2f} ({pnl_pct:.2f}%)")
    
    return {
        'trade_id': trade_id,
        'symbol': trade['symbol'],
        'entry_price': entry_price,
        'exit_price': exit_price,
        'pnl': round(pnl, 2),
        'pnl_pct': round(pnl_pct, 2),
        'agent_id': trade['agent_id'],
        'is_demo': bool(trade['is_demo'])
    }

def update_agent_performance(agent_id: str):
    """Update agent performance metrics after a trade closes"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get all closed trades for this agent
    c.execute('''SELECT pnl, pnl_pct FROM trades 
        WHERE agent_id = ? AND status = 'closed' AND pnl IS NOT NULL''',
        (agent_id,))
    trades = c.fetchall()
    
    if not trades:
        conn.close()
        return
    
    total_trades = len(trades)
    wins = sum(1 for t in trades if t[0] > 0)
    losses = total_trades - wins
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
    
    pnls = [t[0] for t in trades]
    avg_pnl = sum(pnls) / len(pnls)
    total_pnl = sum(pnls)
    
    # Calculate Sharpe ratio (simplified)
    if len(pnls) > 1:
        returns = [t[1] for t in trades]
        mean_return = sum(returns) / len(returns)
        std_return = (sum((r - mean_return) ** 2 for r in returns) / len(returns)) ** 0.5
        sharpe_ratio = (mean_return / std_return) if std_return > 0 else 0
    else:
        sharpe_ratio = 0
    
    # Calculate max drawdown
    cumulative = 0
    peak = 0
    max_dd = 0
    for pnl in pnls:
        cumulative += pnl
        if cumulative > peak:
            peak = cumulative
        drawdown = peak - cumulative
        if drawdown > max_dd:
            max_dd = drawdown
    
    # Update or insert agent performance
    now = datetime.now().isoformat()
    c.execute('''INSERT OR REPLACE INTO agent_performance 
        (agent_id, agent_name, total_trades, wins, losses, win_rate, avg_pnl, total_pnl,
         sharpe_ratio, max_drawdown, current_allocation, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                COALESCE((SELECT current_allocation FROM agent_performance WHERE agent_id = ?), 20.0),
                ?)''',
        (agent_id, agent_id.replace('_', ' ').title(), total_trades, wins, losses,
         win_rate, avg_pnl, total_pnl, sharpe_ratio, max_dd, agent_id, now))
    
    conn.commit()
    conn.close()
    
    print(f"[TradeTracker] Updated {agent_id}: {wins}/{total_trades} wins ({win_rate:.1f}%), Sharpe: {sharpe_ratio:.2f}")

def get_agent_leaderboard() -> List[Dict]:
    """Get agent performance rankings"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('''SELECT * FROM agent_performance 
        WHERE is_active = 1 
        ORDER BY win_rate DESC, sharpe_ratio DESC''')
    
    cols = [desc[0] for desc in c.description]
    agents = [dict(zip(cols, row)) for row in c.fetchall()]
    
    conn.close()
    return agents

def get_trade_history(
    limit: int = 50,
    symbol: Optional[str] = None,
    agent_id: Optional[str] = None,
    is_demo: Optional[bool] = None
) -> List[Dict]:
    """Get historical trades with filters"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    query = 'SELECT * FROM trades WHERE 1=1'
    params = []
    
    if symbol:
        query += ' AND symbol = ?'
        params.append(symbol)
    if agent_id:
        query += ' AND agent_id = ?'
        params.append(agent_id)
    if is_demo is not None:
        query += ' AND is_demo = ?'
        params.append(1 if is_demo else 0)
    
    query += ' ORDER BY timestamp DESC LIMIT ?'
    params.append(limit)
    
    c.execute(query, params)
    cols = [desc[0] for desc in c.description]
    trades = [dict(zip(cols, row)) for row in c.fetchall()]
    
    conn.close()
    return trades

def get_active_trades(is_demo: Optional[bool] = None) -> List[Dict]:
    """Get currently open trades"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    query = 'SELECT * FROM trades WHERE status = "open"'
    params = []
    
    if is_demo is not None:
        query += ' AND is_demo = ?'
        params.append(1 if is_demo else 0)
    
    c.execute(query, params)
    cols = [desc[0] for desc in c.description]
    trades = [dict(zip(cols, row)) for row in c.fetchall()]
    
    conn.close()
    return trades

def log_learning_event(
    event_type: str,
    agent_id: Optional[str] = None,
    old_weight: Optional[float] = None,
    new_weight: Optional[float] = None,
    reason: str = '',
    metadata: Optional[Dict] = None
):
    """Log a learning event"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    now = datetime.now().isoformat()
    c.execute('''INSERT INTO learning_events 
        (timestamp, event_type, agent_id, old_weight, new_weight, reason, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (now, event_type, agent_id, old_weight, new_weight, reason,
         json.dumps(metadata) if metadata else None))
    
    conn.commit()
    conn.close()

def get_learning_events(limit: int = 20) -> List[Dict]:
    """Get recent learning events"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('SELECT * FROM learning_events ORDER BY timestamp DESC LIMIT ?', (limit,))
    cols = [desc[0] for desc in c.description]
    events = [dict(zip(cols, row)) for row in c.fetchall()]
    
    conn.close()
    return events

def get_portfolio_summary(is_demo: bool = True) -> Dict:
    """Get overall portfolio performance summary"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get all closed trades
    c.execute('''SELECT SUM(pnl), COUNT(*), AVG(pnl) FROM trades 
        WHERE status = 'closed' AND is_demo = ?''', (1 if is_demo else 0,))
    total_pnl, total_trades, avg_pnl = c.fetchone()
    
    # Get wins/losses
    c.execute('''SELECT COUNT(*) FROM trades 
        WHERE status = 'closed' AND pnl > 0 AND is_demo = ?''', (1 if is_demo else 0,))
    wins = c.fetchone()[0]
    
    # Get open trades value
    c.execute('''SELECT SUM(entry_price * quantity) FROM trades 
        WHERE status = 'open' AND is_demo = ?''', (1 if is_demo else 0,))
    open_value = c.fetchone()[0] or 0
    
    conn.close()
    
    initial_balance = 100000  # Starting demo balance
    current_balance = initial_balance + (total_pnl or 0)
    win_rate = (wins / total_trades * 100) if total_trades and total_trades > 0 else 0
    
    return {
        'initial_balance': initial_balance,
        'current_balance': round(current_balance, 2),
        'total_pnl': round(total_pnl or 0, 2),
        'total_trades': total_trades or 0,
        'wins': wins or 0,
        'losses': (total_trades or 0) - (wins or 0),
        'win_rate': round(win_rate, 2),
        'avg_pnl': round(avg_pnl or 0, 2),
        'open_positions_value': round(open_value, 2),
        'is_demo': is_demo
    }

def reset_demo_trading():
    """Reset all demo trades and start fresh"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('DELETE FROM trades WHERE is_demo = 1')
    c.execute('DELETE FROM learning_events')
    c.execute('UPDATE agent_performance SET current_allocation = 20.0')
    
    conn.commit()
    conn.close()
    
    log_learning_event(
        event_type='demo_reset',
        reason='Demo mode reset - starting fresh training session'
    )
    
    print("[TradeTracker] Demo mode reset complete")
