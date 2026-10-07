"""
Test Trade Learning System
Simulate SOMA learning from demo trades
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from services.trade_tracker import (
    record_trade, close_trade, get_agent_leaderboard,
    get_portfolio_summary, get_learning_events, reset_demo_trading
)
import time
import random

def simulate_demo_trades():
    """Simulate SOMA making demo trades and learning"""
    
    print("\n" + "="*60)
    print("🎓 SOMA TRADE LEARNING SYSTEM - DEMO MODE")
    print("="*60 + "\n")
    
    # Reset to start fresh
    print("[1] Resetting demo mode...")
    reset_demo_trading()
    
    # Agents
    agents = [
        {'id': 'thesis_agent', 'name': 'Thesis Agent', 'accuracy': 0.75},
        {'id': 'quant_agent', 'name': 'Quant Agent', 'accuracy': 0.68},
        {'id': 'risk_agent', 'name': 'Risk Agent', 'accuracy': 0.55},
        {'id': 'sentiment_agent', 'name': 'Sentiment Agent', 'accuracy': 0.62},
        {'id': 'strategy_agent', 'name': 'Strategy Agent', 'accuracy': 0.71}
    ]
    
    symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AAPL', 'NVDA']
    
    print(f"[2] Simulating 25 demo trades...\n")
    
    # Simulate 25 trades
    for i in range(25):
        # Pick random agent and symbol
        agent = random.choice(agents)
        symbol = random.choice(symbols)
        
        # Entry
        entry_price = random.uniform(100, 50000)
        quantity = random.uniform(0.1, 1.0)
        side = random.choice(['buy', 'long'])
        confidence = random.uniform(0.6, 0.95)
        
        # Open trade
        trade_id = record_trade(
            symbol=symbol,
            entry_price=entry_price,
            quantity=quantity,
            side=side,
            agent_id=agent['id'],
            confidence=confidence,
            is_demo=True
        )
        
        # Simulate market movement
        # Agent with higher accuracy = higher chance of winning
        win_chance = agent['accuracy']
        is_win = random.random() < win_chance
        
        if is_win:
            # Winning trade (2-8% profit)
            move = random.uniform(1.02, 1.08)
        else:
            # Losing trade (1-5% loss)
            move = random.uniform(0.95, 0.99)
        
        exit_price = entry_price * move
        
        # Close trade
        result = close_trade(trade_id, exit_price)
        
        print(f"  Trade #{i+1}: {agent['name']} | {symbol} | {'✅ WIN' if result['pnl'] > 0 else '❌ LOSS'} | P&L: ${result['pnl']:.2f}")
        
        time.sleep(0.1)  # Small delay for readability
    
    print("\n" + "-"*60)
    print("📊 LEARNING RESULTS")
    print("-"*60 + "\n")
    
    # Show agent performance
    leaderboard = get_agent_leaderboard()
    
    print("Agent Performance Leaderboard:\n")
    for idx, agent in enumerate(leaderboard, 1):
        win_rate = agent['win_rate']
        total = agent['total_trades']
        wins = agent['wins']
        pnl = agent['total_pnl']
        sharpe = agent['sharpe_ratio']
        allocation = agent['current_allocation']
        
        # Color based on performance
        if win_rate > 60:
            symbol = "🟢"
        elif win_rate > 50:
            symbol = "🟡"
        else:
            symbol = "🔴"
        
        print(f"{symbol} #{idx}. {agent['agent_name']}")
        print(f"   Win Rate: {win_rate:.1f}% ({wins}/{total})")
        print(f"   Total P&L: ${pnl:.2f}")
        print(f"   Sharpe: {sharpe:.2f}")
        print(f"   Allocation: {allocation:.1f}%")
        print()
    
    # Show portfolio summary
    summary = get_portfolio_summary(is_demo=True)
    
    print("-"*60)
    print("💼 PORTFOLIO SUMMARY")
    print("-"*60 + "\n")
    
    print(f"Starting Balance:  ${summary['initial_balance']:,.2f}")
    print(f"Current Balance:   ${summary['current_balance']:,.2f}")
    print(f"Total P&L:         ${summary['total_pnl']:,.2f}")
    print(f"Win Rate:          {summary['win_rate']:.1f}% ({summary['wins']}/{summary['total_trades']})")
    print(f"Average P&L:       ${summary['avg_pnl']:.2f}")
    
    # Show recent learning events
    print("\n" + "-"*60)
    print("🧠 RECENT LEARNING EVENTS")
    print("-"*60 + "\n")
    
    events = get_learning_events(limit=10)
    
    for event in events[:5]:
        timestamp = event['timestamp'].split('T')[1][:8]
        print(f"[{timestamp}] {event['event_type']}: {event['reason']}")
    
    print("\n" + "="*60)
    print("✅ Demo Complete! SOMA has learned from 25 trades.")
    print("="*60 + "\n")
    
    # Show improvement suggestion
    best_agent = leaderboard[0] if leaderboard else None
    if best_agent and best_agent['win_rate'] > 65:
        print(f"💡 Insight: {best_agent['agent_name']} is performing exceptionally well!")
        print(f"   SOMA should increase allocation to this agent.\n")

if __name__ == '__main__':
    simulate_demo_trades()
