import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Activity,
  BarChart3, Settings, Search, AlertTriangle, CheckCircle,
  PieChart as PieChartIcon, Briefcase, Bookmark, Clock,
  User2, Zap, Shield, X, RefreshCw, TrendingUpIcon, Filter, Bell
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';

import Marketplace from '../Marketplace';
import FileBrowser from './FileBrowser';
import PulseInterface from './PulseInterface';
import MissionControl from './finance/MissionControl';
import somaBackend from '../../../somaBackend';

const FinanceModule = () => {
  // Disclaimer State
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    () => localStorage.getItem('soma_finance_disclaimer_accepted') === 'true'
  );

  // Alpaca State
  const [alpacaConnected, setAlpacaConnected] = useState(false);
  const [showAlpacaSetup, setShowAlpacaSetup] = useState(false);
  const [alpacaKeys, setAlpacaKeys] = useState({
    apiKey: localStorage.getItem('alpaca_api_key') || '',
    apiSecret: localStorage.getItem('alpaca_api_secret') || '',
    paperTrading: localStorage.getItem('alpaca_paper_trading') !== 'false'
  });
  const [alpacaAccount, setAlpacaAccount] = useState(null);
  const [alpacaOrders, setAlpacaOrders] = useState([]);
  const [showSafetyChecks, setShowSafetyChecks] = useState(false);
  const [safetyChecksResult, setSafetyChecksResult] = useState(null);

  const [activeTab, setActiveTab] = useState('analysis'); // 'analysis' | 'portfolio'
  const [symbol, setSymbol] = useState('BTC'); const [source, setSource] = useState('yahoo');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem('soma_finance_history') || '[]'));
  const [watchlist, setWatchlist] = useState(() => JSON.parse(localStorage.getItem('soma_finance_watchlist') || '[]'));
  const [alerts, setAlerts] = useState(() => JSON.parse(localStorage.getItem('soma_finance_alerts') || '[]'));
  const [screenerFilters, setScreenerFilters] = useState({ sector: 'All', signal: 'All', minPrice: 0 });
  const [screenerResults, setScreenerResults] = useState(null);
  const [clones, setClones] = useState([]);

  useEffect(() => {
    localStorage.setItem('soma_finance_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('soma_finance_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem('soma_finance_alerts', JSON.stringify(alerts));
  }, [alerts]);

  const saveToHistory = (result) => {
    setHistory(prev => [result, ...prev].slice(0, 50)); // Keep last 50
  };

  const toggleWatchlist = (sym) => {
    if (watchlist.includes(sym)) {
      setWatchlist(prev => prev.filter(s => s !== sym));
    } else {
      setWatchlist(prev => [...prev, sym]);
    }
  };

  const getArgumentStrength = (thesis) => {
    if (!thesis) return 0;
    return Math.min(100, Math.floor(thesis.length / 5));
  };

  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiKeys, setApiKeys] = useState({
    alphavantage: localStorage.getItem('mercury_alphavantage') || '',
    finnhub: localStorage.getItem('mercury_finnhub') || ''
  });

  const saveApiKeys = () => {
    localStorage.setItem('mercury_alphavantage', apiKeys.alphavantage);
    localStorage.setItem('mercury_finnhub', apiKeys.finnhub);
    setShowApiConfig(false);
  };

  const runDeepAnalysis = async () => {
    if (!symbol) return;
    setLoading(true);
    setAnalysisResult(null);

    try {
      const response = await fetch('/api/finance/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      const data = await response.json();

      if (data.success && data.analysis) {
        setAnalysisResult(data.analysis);
        saveToHistory(data.analysis);
      }
    } catch (err) {
      console.error('Deep Analysis Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const spawnClones = async (sym) => {
    setClones([]);
    const cloneTypes = [
      `Mercury.${sym}`,
      'Price Monitor',
      'Volume Analyzer',
      'Sentiment Scanner',
      'Technical Signals'
    ];

    for (const type of cloneTypes) {
      await new Promise(r => setTimeout(r, 300));
      setClones(prev => [...prev, type]);
    }
  };

  // Real-time Polling Ref
  const pollingRef = React.useRef(null);

  const fetchQuote = async (showLoading = false) => {
    if (!symbol) return;
    if (showLoading) setLoading(true);

    try {
      const apiKey = source === 'alphavantage' ? apiKeys.alphavantage :
        source === 'finnhub' ? apiKeys.finnhub : '';

      const response = await fetch(`/api/finance/quote?symbol=${symbol}&source=${source}`, {
        headers: { 'x-api-key': apiKey }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setData(result.data);
        }
      }
    } catch (err) {
      console.error('Finance API Error:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Poll for price updates
  useEffect(() => {
    if (data && symbol) {
      pollingRef.current = setInterval(() => fetchQuote(false), 5000);
    }
    return () => clearInterval(pollingRef.current);
  }, [data, symbol, source]);

  const analyzeMarket = async () => {
    if (!symbol) return;
    setLoading(true);
    setData(null);

    // 1. Spawn Clones
    await spawnClones(symbol);

    // 2. Initial Fetch
    await fetchQuote(true);
  };

  // Helper to render chart patterns
  const renderChartPatterns = () => {
    if (!analysisResult?.vision?.detected_patterns) return null;

    return analysisResult.vision.detected_patterns.map((pattern, i) => {
      if (pattern.name.includes('Support') || pattern.name.includes('Resistance')) {
        return (
          <ReferenceLine
            key={i}
            y={pattern.price}
            stroke={pattern.name.includes('Support') ? '#10b981' : '#ef4444'}
            strokeDasharray="3 3"
            label={{ position: 'right', value: pattern.name, fill: '#fff', fontSize: 10 }}
          />
        );
      }
      return null;
    });
  };

  // ============================================================================
  // ALPACA INTEGRATION FUNCTIONS
  // ============================================================================

  const connectToAlpaca = async () => {
    try {
      const response = await fetch('/api/alpaca/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alpacaKeys)
      });

      const result = await response.json();

      if (result.success) {
        setAlpacaConnected(true);
        setAlpacaAccount(result.account);
        setShowAlpacaSetup(false);

        // Save keys to localStorage
        localStorage.setItem('alpaca_api_key', alpacaKeys.apiKey);
        localStorage.setItem('alpaca_api_secret', alpacaKeys.apiSecret);
        localStorage.setItem('alpaca_paper_trading', alpacaKeys.paperTrading);

        // Fetch initial orders
        fetchAlpacaOrders();

        alert(`✅ Connected to Alpaca (${result.account.mode.toUpperCase()} mode)`);
      } else {
        alert(`❌ Connection failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Alpaca connection error:', error);
      alert('Failed to connect to Alpaca');
    }
  };

  const disconnectFromAlpaca = async () => {
    try {
      await fetch('/api/alpaca/disconnect', { method: 'POST' });
      setAlpacaConnected(false);
      setAlpacaAccount(null);
      setAlpacaOrders([]);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };

  const fetchAlpacaAccount = async () => {
    try {
      const response = await fetch('/api/alpaca/account');
      const result = await response.json();

      if (result.success) {
        setAlpacaAccount(result.account);
      }
    } catch (error) {
      console.error('Account fetch error:', error);
    }
  };

  const fetchAlpacaOrders = async () => {
    try {
      const response = await fetch('/api/alpaca/orders?status=all&limit=20');
      const result = await response.json();

      if (result.success) {
        setAlpacaOrders(result.orders);
      }
    } catch (error) {
      console.error('Orders fetch error:', error);
    }
  };

  const executeSOMATrade = async () => {
    if (!symbol || !analysisResult) {
      alert('Please run a deep analysis first');
      return;
    }

    const confirmed = window.confirm(
      `🚨 EXECUTE REAL MONEY TRADE?\n\n` +
      `Symbol: ${symbol}\n` +
      `Recommendation: ${analysisResult.strategy?.recommendation}\n` +
      `Confidence: ${(analysisResult.strategy?.confidence * 100).toFixed(0)}%\n` +
      `Account: ${alpacaAccount?.mode.toUpperCase()}\n\n` +
      `This will use REAL ${alpacaKeys.paperTrading ? 'PAPER' : 'LIVE'} money!\n\n` +
      `Are you absolutely sure?`
    );

    if (!confirmed) return;

    try {
      setLoading(true);

      const response = await fetch('/api/alpaca/execute-soma-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          userConfirmation: true
        })
      });

      const result = await response.json();

      if (result.success) {
        setSafetyChecksResult(result);
        setShowSafetyChecks(true);
        alert(`✅ Trade executed successfully!\n\nOrder ID: ${result.order.id}`);

        // Refresh account and orders
        fetchAlpacaAccount();
        fetchAlpacaOrders();
      } else if (result.blocked) {
        setSafetyChecksResult(result);
        setShowSafetyChecks(true);
        alert(`🚫 Trade blocked by safety checks:\n\n${result.reason}`);
      } else {
        alert(`❌ Trade failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Trade execution error:', error);
      alert('Failed to execute trade');
    } finally {
      setLoading(false);
    }
  };

  const acceptDisclaimer = () => {
    localStorage.setItem('soma_finance_disclaimer_accepted', 'true');
    setDisclaimerAccepted(true);
  };

  // Auto-refresh Alpaca account if connected
  useEffect(() => {
    if (alpacaConnected) {
      const interval = setInterval(fetchAlpacaAccount, 10000); // Every 10 seconds
      return () => clearInterval(interval);
    }
  }, [alpacaConnected]);

  // If disclaimer not accepted, show ghost screen
  if (!disclaimerAccepted) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-lg animate-in fade-in duration-500">
        <div className="max-w-2xl mx-auto p-8 bg-gradient-to-br from-red-900/20 to-orange-900/20 border-2 border-red-500/50 rounded-2xl shadow-2xl shadow-red-500/20 animate-in zoom-in duration-700">
          {/* Skull icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center animate-pulse">
              <AlertTriangle className="w-12 h-12 text-red-500" />
            </div>
          </div>

          <h1 className="text-4xl font-black text-red-500 text-center mb-6 tracking-tight">
            ⚠️ LEGAL DISCLAIMER ⚠️
          </h1>

          <div className="space-y-4 text-zinc-300 text-sm leading-relaxed bg-black/40 p-6 rounded-xl border border-red-500/30 mb-6 max-h-96 overflow-y-auto">
            <p className="text-base font-bold text-red-400">
              READ THIS CAREFULLY BEFORE PROCEEDING
            </p>

            <p>
              This system is for <strong className="text-white">educational and research purposes only</strong>.
              SOMA is <strong className="text-red-400">NOT</strong> a licensed investment advisor or broker-dealer.
            </p>

            <p className="text-amber-300 font-semibold">
              🔥 AUTOMATED TRADING INVOLVES SUBSTANTIAL RISK OF LOSS 🔥
            </p>

            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Past performance does <strong>NOT</strong> guarantee future results</li>
              <li>You could lose <strong>ALL</strong> of your invested capital</li>
              <li>Trading algorithms can malfunction and cause unexpected losses</li>
              <li>Market conditions can change rapidly, invalidating AI predictions</li>
              <li>Technical failures may prevent you from closing losing positions</li>
            </ul>

            <p className="text-amber-300 font-semibold">
              ⚖️ LEGAL NOTICE
            </p>

            <p>
              By using this system, you acknowledge and agree that:
            </p>

            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>You trade <strong>AT YOUR OWN RISK</strong></li>
              <li>The creators assume <strong>NO LIABILITY</strong> for financial losses</li>
              <li>This is <strong>NOT</strong> financial advice or investment recommendations</li>
              <li>You should consult a licensed financial advisor before trading</li>
              <li>You understand that AI systems can make mistakes</li>
              <li>You will not hold SOMA, its creators, or contributors responsible for losses</li>
            </ul>

            <p className="text-rose-400 font-bold text-base">
              🚨 ONLY RISK CAPITAL YOU CAN AFFORD TO LOSE 🚨
            </p>

            <p className="text-zinc-400 text-xs italic mt-4">
              This software is provided "AS IS" without warranty of any kind, express or implied.
              The entire risk as to the quality and performance of the software is with you.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={acceptDisclaimer}
              className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold text-lg rounded-xl transition-all transform hover:scale-105 shadow-lg shadow-red-500/50"
            >
              I UNDERSTAND THE RISKS - PROCEED
            </button>

            <p className="text-center text-xs text-zinc-500">
              By clicking above, you confirm that you have read and understood this disclaimer
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-200">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
          <DollarSign className="w-6 h-6 mr-3 text-emerald-400" /> Financial Intelligence
        </h2>
        <button
          onClick={() => setShowApiConfig(true)}
          className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-4 border-b border-white/10 pb-1 mb-4">
        <button
          onClick={() => setActiveTab('analysis')}
          className={`pb-2 px-2 text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'analysis' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
        >
          Analysis
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`pb-2 px-2 text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'portfolio' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
        >
          Portfolio
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`pb-2 px-2 text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'tools' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
        >
          Advanced Tools
        </button>
        <button
          onClick={() => setActiveTab('mission')}
          className={`pb-2 px-2 text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'mission' ? 'text-soma-accent border-b-2 border-soma-accent' : 'text-zinc-500 hover:text-zinc-300'
            }`}
        >
          MISSION CONTROL
        </button>
      </div>

      {/* API Config Modal */}
      {showApiConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowApiConfig(false)}>
          <div className="bg-[#151518] border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">API Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Alpha Vantage Key</label>
                <input
                  type="text"
                  value={apiKeys.alphavantage}
                  onChange={e => setApiKeys({ ...apiKeys, alphavantage: e.target.value })}
                  className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm focus:border-emerald-500/50 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Finnhub Key</label>
                <input
                  type="text"
                  value={apiKeys.finnhub}
                  onChange={e => setApiKeys({ ...apiKeys, finnhub: e.target.value })}
                  className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm focus:border-emerald-500/50 outline-none"
                />
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <button
                  onClick={() => setShowApiConfig(false)}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveApiKeys}
                  className="px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-sm font-bold hover:bg-emerald-500/30"
                >
                  Save Keys
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === 'mission' ? (
        <div className="h-[80vh] overflow-hidden rounded-xl border border-white/10 shadow-2xl">
          <MissionControl />
        </div>
      ) : activeTab === 'analysis' ? (
        // ANALYSIS VIEW
        <>
          {/* Input Section */}
          <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Stock Symbol</label>
                <div className="relative">
                  <input
                    type="text"
                    value={symbol}
                    onChange={e => setSymbol(e.target.value.toUpperCase())}
                    placeholder="BTC, ETH, SOL, AAPL..."
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder-zinc-600 focus:border-emerald-500/50 outline-none font-mono tracking-wider"
                  />
                  <Search className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Data Source</label>
                <select
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 outline-none appearance-none"
                >
                  <option value="binance">Binance (Crypto - Free)</option>
                  <option value="coingecko">CoinGecko (Crypto - Free)</option>
                  <option value="yahoo">Yahoo Finance (Free)</option>
                  <option value="alphavantage">Alpha Vantage</option>
                  <option value="finnhub">Finnhub</option>
                </select>
              </div>
              <button
                onClick={analyzeMarket}
                disabled={loading}
                className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition-all ${loading
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  }`}
              >
                {loading ? 'Analyzing...' : 'Analyze Market'}
              </button>

              <button
                onClick={runDeepAnalysis}
                disabled={loading}
                className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition-all ${loading
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 hover:border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.1)] hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                  }`}
              >
                Deep Agent Analysis
              </button>
            </div>
          </div>

          {/* Active Clones Visualization */}
          {clones.length > 0 && (
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4">Polymorphic Clones Active</h3>
              <div className="flex flex-wrap gap-3">
                {clones.map((clone, i) => (
                  <div key={i} className="px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-emerald-400/80 text-xs font-mono animate-in zoom-in duration-300">
                    <span className="mr-2">●</span>{clone}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results Dashboard */}
          {data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">

              {/* Main Stats */}
              <div className="col-span-1 space-y-4">
                <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg">
                  <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-1">Current Price</div>
                  <div className="text-3xl font-bold text-white font-mono">${data.price}</div>
                  <div className={`flex items-center mt-2 text-sm font-bold ${parseFloat(data.change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {parseFloat(data.change) >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                    {data.change > 0 ? '+' : ''}{data.change}%
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg">
                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">RSI (14)</div>
                    <div className="text-xl font-bold text-zinc-200 font-mono">{data.rsi}</div>
                  </div>
                  <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg">
                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">Volume</div>
                    <div className="text-xl font-bold text-zinc-200 font-mono">{(data.volume / 1000000).toFixed(1)}M</div>
                  </div>
                </div>

                <div className={`bg-[#151518]/60 backdrop-blur-md border rounded-xl p-5 shadow-lg ${data.signal === 'BUY' ? 'border-emerald-500/30 bg-emerald-500/5' :
                    data.signal === 'SELL' ? 'border-rose-500/30 bg-rose-500/5' :
                      'border-amber-500/30 bg-amber-500/5'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Signal</div>
                    <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Confidence</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className={`text-2xl font-bold ${data.signal === 'BUY' ? 'text-emerald-400' :
                        data.signal === 'SELL' ? 'text-rose-400' :
                          'text-amber-400'
                      }`}>
                      {data.signal}
                    </div>
                    <div className="text-xl font-bold text-white font-mono">{data.confidence}%</div>
                  </div>
                </div>
              </div>

              {/* Chart Area */}
              <div className="col-span-2 bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-200 font-semibold text-sm uppercase tracking-wider">Price History</h3>
                  <div className="flex space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] text-emerald-500 font-bold uppercase">Live</span>
                  </div>
                </div>
                <div className="flex-1 w-full min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="time" stroke="#52525b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis domain={['auto', 'auto']} stroke="#52525b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '12px' }}
                        itemStyle={{ color: '#e4e4e7' }}
                      />
                      {renderChartPatterns()}
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: '#10b981' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

          {/* Deep Analysis Result (Hedge Fund View) */}
          {analysisResult && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Header */}
              <div className="flex items-center space-x-3 pb-4 border-b border-white/10">
                <Search className="w-6 h-6 text-purple-400" />
                <div>
                  <h3 className="text-xl font-bold text-white">SOMA Hedge Fund Report: {symbol}</h3>
                  <div className="text-xs text-zinc-500">Deep Agent Swarm • Multi-Modal Analysis • {analysisResult.timestamp}</div>
                </div>
              </div>

              {/* 1. The Debate (Society of Markets) */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-sm font-bold text-zinc-400 uppercase flex items-center">
                    <Activity className="w-4 h-4 mr-2" /> Society of Markets Debate
                  </h4>
                  <div className="px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded text-[10px] font-bold text-purple-400 uppercase tracking-widest">
                    Adversarial Swarm Active
                  </div>
                </div>

                <div className="space-y-8 relative">
                  {/* Connecting Line */}
                  <div className="absolute left-6 top-10 bottom-10 w-0.5 bg-gradient-to-b from-emerald-500/20 via-white/5 to-rose-500/20" />

                  {/* Bull Case */}
                  <div className="relative pl-12">
                    <div className="absolute left-0 top-0 w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center z-10 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                      <TrendingUp className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div className="bg-emerald-900/5 border border-emerald-500/10 rounded-2xl p-5 relative after:content-[''] after:absolute after:left-[-8px] after:top-4 after:w-0 after:h-0 after:border-t-[8px] after:border-t-transparent after:border-b-[8px] after:border-b-transparent after:border-r-[8px] after:border-r-emerald-500/10">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-emerald-400 font-black text-xs uppercase tracking-tighter italic">The Optimization Bull</span>
                        <div className="flex items-center space-x-2">
                          <span className="text-[9px] text-zinc-500 uppercase font-bold">Strength</span>
                          <div className="w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${getArgumentStrength(analysisResult.debate?.bull_thesis)}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed italic">"{analysisResult.debate?.bull_thesis}"</p>
                    </div>
                  </div>

                  {/* Bear Case */}
                  <div className="relative pl-12">
                    <div className="absolute left-0 top-0 w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-full flex items-center justify-center z-10 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                      <TrendingDown className="w-6 h-6 text-rose-400" />
                    </div>
                    <div className="bg-rose-900/5 border border-rose-500/10 rounded-2xl p-5 relative after:content-[''] after:absolute after:left-[-8px] after:top-4 after:w-0 after:h-0 after:border-t-[8px] after:border-t-transparent after:border-b-[8px] after:border-b-transparent after:border-r-[8px] after:border-r-rose-500/10">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-rose-400 font-black text-xs uppercase tracking-tighter italic">The Risk Bear</span>
                        <div className="flex items-center space-x-2">
                          <span className="text-[9px] text-zinc-500 uppercase font-bold">Strength</span>
                          <div className="w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500" style={{ width: `${getArgumentStrength(analysisResult.debate?.bear_thesis)}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed italic">"{analysisResult.debate?.bear_thesis}"</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Quantitative Backtest & Vision */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                  <h4 className="text-sm font-bold text-zinc-400 uppercase mb-4 flex items-center">
                    <BarChart3 className="w-4 h-4 mr-2" /> Python Backtest Results
                  </h4>
                  {analysisResult.quant?.backtest_results ? (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex justify-between border-b border-white/5 pb-2">
                          <span className="text-zinc-500 text-xs">Strategy</span>
                          <span className="text-purple-400 text-xs font-mono">{analysisResult.quant.strategy}</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-2">
                          <span className="text-zinc-500 text-xs">Sharpe Ratio</span>
                          <span className="text-zinc-200 text-xs font-mono">{analysisResult.quant.backtest_results.sharpe_ratio}</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-2">
                          <span className="text-zinc-500 text-xs">Annual Return</span>
                          <span className="text-emerald-400 text-xs font-mono">{analysisResult.quant.backtest_results.annual_return}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500 text-xs">Max Drawdown</span>
                          <span className="text-rose-400 text-xs font-mono">{analysisResult.quant.backtest_results.max_drawdown}</span>
                        </div>
                      </div>

                      {/* Equity Curve Visualization */}
                      <div className="h-32 w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={Array.from({ length: 20 }, (_, i) => ({
                            step: i,
                            equity: 10000 * Math.pow(1 + (parseFloat(analysisResult.quant.backtest_results.annual_return) / 100) / 252, i * 10) * (1 + (Math.random() * 0.05 - 0.02))
                          }))}>
                            <defs>
                              <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Tooltip
                              contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '10px' }}
                              itemStyle={{ color: '#10b981' }}
                              formatter={(value) => [`$${value.toFixed(0)}`, 'Equity']}
                              labelFormatter={() => ''}
                            />
                            <Area type="monotone" dataKey="equity" stroke="#10b981" fillOpacity={1} fill="url(#colorEquity)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div className="text-center text-[10px] text-zinc-500 mt-1">Projected Equity Curve</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-zinc-500 text-xs italic">Backtest data unavailable</div>
                  )}
                </div>

                <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                  <h4 className="text-sm font-bold text-zinc-400 uppercase mb-4 flex items-center">
                    <Search className="w-4 h-4 mr-2" /> Visual & Sentiment Analysis
                  </h4>
                  <div className="space-y-4">
                    <div>
                      <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">Chart Vision</div>
                      <div className="text-xs text-zinc-300">
                        {analysisResult.vision?.detected_patterns?.map(p => p.name).join(', ') || 'No patterns detected'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">Market Psychology</div>
                      <div className="flex items-center space-x-2">
                        <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${analysisResult.sentiment?.score > 0.5 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${(analysisResult.sentiment?.score || 0.5) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono">{analysisResult.sentiment?.label}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Final Verdict */}
              <div className={`rounded-xl p-6 border shadow-2xl ${analysisResult.strategy?.recommendation?.includes('BUY')
                  ? 'bg-emerald-900/20 border-emerald-500/30'
                  : 'bg-rose-900/20 border-rose-500/30'
                }`}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-400 uppercase mb-1">Strategist Verdict</h4>
                    <div className={`text-3xl font-black tracking-tight ${analysisResult.strategy?.recommendation?.includes('BUY') ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                      {analysisResult.strategy?.recommendation}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-zinc-500 text-xs uppercase font-bold mb-1">Conviction</div>
                    <div className="text-2xl font-mono text-white">{(analysisResult.strategy?.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed font-serif border-l-2 border-white/10 pl-4">
                  "{analysisResult.strategy?.rationale}"
                </p>

                {/* EXECUTE REAL TRADE BUTTON */}
                {alpacaConnected && (
                  <div className="mt-6 pt-6 border-t border-white/10">
                    <button
                      onClick={executeSOMATrade}
                      disabled={loading || analysisResult.strategy?.confidence < 0.5}
                      className="w-full py-4 bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:from-purple-500 hover:via-fuchsia-500 hover:to-pink-500 text-white font-black text-lg rounded-xl transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg shadow-purple-500/30 animate-pulse"
                    >
                      🚀 EXECUTE REAL {alpacaKeys.paperTrading ? 'PAPER' : 'LIVE'} TRADE
                    </button>
                    <p className="text-xs text-zinc-500 text-center mt-2">
                      Trade will be executed on Alpaca {alpacaAccount?.mode.toUpperCase()} account
                    </p>
                  </div>
                )}

                {!alpacaConnected && (
                  <div className="mt-6 pt-6 border-t border-white/10">
                    <button
                      onClick={() => setShowAlpacaSetup(true)}
                      className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white font-bold text-lg rounded-xl transition-all border-2 border-dashed border-zinc-700 hover:border-purple-500/50"
                    >
                      Connect Alpaca to Execute Real Trades
                    </button>
                  </div>
                )}

                {/* Paper Trade Status */}
                {analysisResult.trade && (
                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                    <div className="text-xs text-zinc-400">
                      Paper Portfolio: <span className="text-white font-mono">${analysisResult.portfolio?.total_value?.toLocaleString()}</span>
                    </div>
                    <div className="px-2 py-1 bg-black/30 rounded text-[10px] font-mono border border-white/10">
                      Trade: {analysisResult.trade.status} ({analysisResult.trade.reason || `${analysisResult.trade.side} ${analysisResult.trade.shares}`})
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        // PORTFOLIO VIEW
        <div className="space-y-6 animate-in fade-in zoom-in duration-300">
          {/* Portfolio Summary Card */}
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg col-span-3">
              <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4">Total Portfolio Value</h3>
              <div className="flex items-end space-x-4">
                <span className="text-4xl font-bold text-white font-mono">
                  ${(analysisResult?.portfolio?.total_value || 100000).toLocaleString()}
                </span>
                <span className="text-sm text-emerald-400 mb-1">+2.4% (Today)</span>
              </div>
              <div className="w-full bg-zinc-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-purple-500 w-3/4"></div>
              </div>
            </div>
          </div>

          {/* Holdings & Allocation */}
          <div className="grid grid-cols-2 gap-6">
            {/* Positions Table */}
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
              <h4 className="text-sm font-bold text-zinc-400 uppercase mb-4 flex items-center">
                <Briefcase className="w-4 h-4 mr-2" /> Current Positions
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-500 uppercase border-b border-white/10">
                    <tr>
                      <th className="pb-2">Asset</th>
                      <th className="pb-2">Shares</th>
                      <th className="pb-2">Avg Price</th>
                      <th className="pb-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {Object.entries(analysisResult?.portfolio?.positions || { 'BTC': { shares: 0.5, cost_basis: 64000 }, 'CASH': { shares: 1, cost_basis: 1 } }).map(([sym, pos]) => (
                      <tr key={sym} className="group hover:bg-white/5 transition-colors">
                        <td className="py-3 font-bold text-white">{sym}</td>
                        <td className="py-3 text-zinc-300 font-mono">{pos.shares}</td>
                        <td className="py-3 text-zinc-400 font-mono">${pos.cost_basis}</td>
                        <td className="py-3 text-right font-mono text-emerald-400">
                          ${(pos.shares * (sym === 'CASH' ? 1 : (data?.price || pos.cost_basis))).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Allocation Chart */}
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg flex flex-col items-center justify-center">
              <h4 className="text-sm font-bold text-zinc-400 uppercase mb-4 w-full text-left">Asset Allocation</h4>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Crypto', value: 65 },
                        { name: 'Stocks', value: 25 },
                        { name: 'Cash', value: 10 },
                      ]}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#8b5cf6" />
                      <Cell fill="#3f3f46" />
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '8px' }}
                      itemStyle={{ color: '#e4e4e7' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex space-x-4 mt-4 text-xs">
                <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></div>Crypto</div>
                <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-purple-500 mr-2"></div>Stocks</div>
                <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-zinc-700 mr-2"></div>Cash</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceModule;
