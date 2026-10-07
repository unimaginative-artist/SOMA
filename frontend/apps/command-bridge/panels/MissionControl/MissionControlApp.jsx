import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GlobalControls } from './components/GlobalControls.jsx';
import { ChevronDown, ChevronUp, Activity, MessageSquare, CheckCircle, XCircle, AlertTriangle, Send, X, Clock, Swords, BookOpen, FlaskConical, BarChart2, Bell, Bot, ScrollText, Target, Database, Wallet, TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import { useMarketEngine, MarketMonitor, MarketDeepScan } from './components/MarketRadar.jsx';
import { StrategyBrain } from './components/StrategyBrain.jsx';
import { TradeStream } from './components/TradeStream.jsx';
import { EvidenceBriefPanel, EvidenceTimelinePanel } from './components/EvidencePanels.jsx';
import { TradeThesisPanel } from './components/TradeThesisPanel.jsx';
import { CommandPanel } from './components/CommandPanel.jsx';
import { MainChart } from './components/MainChart.jsx';
import { RiskPanel } from './components/RiskPanel.jsx';
import { AIAnalysisModal } from './components/AIAnalysisModal.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { LearningDashboard } from './components/LearningDashboard.jsx';
import { DemoTrainingPanel } from './components/DemoTrainingPanel.jsx';
import { ManualWorkstation } from './components/ManualWorkstation.jsx'; // Import Manual Mode
import CustomMarketView from './CustomMarketView/CustomMarketView.jsx';
import DebateArena from './components/DebateArena.jsx';
import { BacktestPanel } from './components/BacktestPanel.jsx';
import { AlertsPanel } from './components/AlertsPanel.jsx';
import { SimIntelPanel } from './components/SimIntelPanel.jsx';
import { LifecycleJournalPanel } from './components/LifecycleJournalPanel.jsx';
import { MissionBriefPanel } from './components/MissionBriefPanel.jsx';
import { StrategyHuntPanel } from './components/StrategyHuntPanel.jsx';
import { PnlSummaryCard, computeMissionPnl, formatMoney, pnlTextColor } from './components/PnlSummary.jsx';
import { TradeMode, AssetType } from './types.js';
import AgenticProofPanel from '../../components/AgenticProofPanel.jsx';
import TradingEcosystemPanel from '../../components/TradingEcosystemPanel.jsx';
import TradingMissionPanel, { useTradingMission } from '../../components/TradingMissionPanel.jsx';

import { INITIAL_TICKERS, STRATEGY_PRESETS } from './constants.js';
import './mission-control.css';

const fmt = (n, decimals = 2) => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtUsd = (n) => n == null ? '—' : `$${fmt(n)}`;

const PortfolioPanel = ({ riskMetrics, positions = [], orders = [], trades = [], isDemoMode, autonomousStatus, paperModeSource = 'internal' }) => {
    const pnl = computeMissionPnl({ riskMetrics, autonomousStatus, positions, trades });

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-3 flex flex-col gap-3">
            {/* Mode badge */}
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest w-fit ${isDemoMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isDemoMode ? 'bg-amber-400' : 'bg-rose-400 animate-pulse'}`} />
                {isDemoMode ? (paperModeSource === 'alpaca_paper' ? 'Alpaca Paper' : 'Internal Paper') : 'Live Mode'}
            </div>

            {/* Internal paper mode warning — no Alpaca keys configured */}
            {isDemoMode && paperModeSource === 'internal' && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[9px] bg-amber-900/20 border border-amber-500/20 text-amber-300">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    No Alpaca keys — trades stay inside SOMA. Add paper keys in Settings to reach Alpaca.
                </div>
            )}

            {/* Balance cards */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: 'Equity', value: fmtUsd(riskMetrics?.equity) },
                    { label: 'Wallet', value: fmtUsd(riskMetrics?.walletBalance) },
                ].map(({ label, value }) => (
                    <div key={label} className="bg-black/40 border border-white/5 rounded p-2">
                        <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">{label}</div>
                        <div className="text-sm font-mono font-bold text-zinc-200">{value}</div>
                    </div>
                ))}
            </div>

            <PnlSummaryCard summary={pnl} title="Session P&L" />

            {/* Open positions */}
            <div>
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">Open Positions</div>
                {positions.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 italic py-2 text-center">No open positions</div>
                ) : (
                    <div className="flex flex-col gap-1">
                        {positions.map((p, i) => {
                            const sym = p.symbol || p.Symbol || '—';
                            const qty = p.qty ?? p.Qty ?? p.quantity ?? 0;
                            const upnl = p.unrealizedPnl ?? parseFloat(p.unrealized_pl ?? 0);
                            const side = parseFloat(qty) >= 0 ? 'LONG' : 'SHORT';
                            return (
                                <div key={i} className="flex items-center justify-between bg-black/30 border border-white/5 rounded px-2 py-1.5">
                                    <div>
                                        <div className="text-xs font-mono font-bold text-zinc-200">{sym}</div>
                                        <div className="text-[9px] text-zinc-600">{side} · {Math.abs(qty)}</div>
                                    </div>
                                    <div className={`text-xs font-mono font-bold ${pnlTextColor(upnl)}`}>
                                        {upnl >= 0 ? '+' : ''}{fmtUsd(upnl)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Pending orders */}
            {orders.length > 0 && (
                <div>
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">Pending Orders</div>
                    <div className="flex flex-col gap-1">
                        {orders.slice(0, 5).map((o, i) => {
                            const side = o.side || o.Side || '?';
                            const sym = o.symbol || o.Symbol || '—';
                            const qty = o.qty || o.Qty || o.quantity || 0;
                            const price = o.limit_price ?? o.stop_price ?? null;
                            return (
                                <div key={i} className="flex items-center justify-between bg-black/20 border border-white/5 rounded px-2 py-1">
                                    <div className="text-[10px] font-mono text-zinc-400">
                                        <span className={side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>{side.toUpperCase()}</span>
                                        {' '}{qty} {sym}
                                    </div>
                                    {price != null && <div className="text-[9px] font-mono text-zinc-500">@ {fmtUsd(price)}</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Risk metrics */}
            <div>
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">Risk Metrics</div>
                <div className="grid grid-cols-2 gap-1">
                    {[
                        { label: 'Daily Drawdown', value: riskMetrics?.dailyDrawdown != null ? `${fmt(riskMetrics.dailyDrawdown)}%` : '—' },
                        { label: 'DD Limit', value: riskMetrics?.maxDrawdownLimit != null ? `${fmt(riskMetrics.maxDrawdownLimit)}%` : '—' },
                        { label: 'Sharpe', value: riskMetrics?.sharpeRatio != null ? fmt(riskMetrics.sharpeRatio) : '—' },
                        { label: 'Sortino', value: riskMetrics?.sortinoRatio != null ? fmt(riskMetrics.sortinoRatio) : '—' },
                    ].map(({ label, value }) => (
                        <div key={label} className="bg-black/30 border border-white/5 rounded px-2 py-1">
                            <div className="text-[8px] text-zinc-600 uppercase">{label}</div>
                            <div className="text-[10px] font-mono text-zinc-300">{value}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const CAPITAL_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000];

const TradeStrategyGate = ({ symbol, presetId, isDemoMode, dataSource, running, onRun, onSkip, onSettings, onPresetChange }) => {
    const [capital, setCapital] = React.useState(10000);
    const [positionPct, setPositionPct] = React.useState(10);
    const [customCapital, setCustomCapital] = React.useState('');
    const [useCustom, setUseCustom] = React.useState(false);

    // Determine asset type from symbol for preset filtering
    const symbolAssetType = React.useMemo(() => {
        if (!symbol) return AssetType.CRYPTO;
        if (symbol.includes('-PERP') || symbol.includes('1!')) return AssetType.FUTURES;
        if (symbol.includes('-USD') || symbol.includes('-USDT') || symbol.includes('-BTC')) return AssetType.CRYPTO;
        return AssetType.STOCKS;
    }, [symbol]);

    // Auto-select best preset for symbol type on mount
    const autoPreset = React.useMemo(() => {
        const compatible = STRATEGY_PRESETS.filter(p => p.assetTypes?.includes(symbolAssetType));
        if (symbolAssetType === AssetType.CRYPTO) return compatible.find(p => p.id === 'BTC_NATIVE') || compatible[0];
        if (symbolAssetType === AssetType.STOCKS) return compatible.find(p => p.id === 'BALANCED') || compatible[0];
        return compatible.find(p => p.id === 'HIGH_PROBABILITY') || compatible[0];
    }, [symbolAssetType]);

    const [selectedPreset, setSelectedPreset] = React.useState(() =>
        STRATEGY_PRESETS.find(p => p.id === presetId) || autoPreset
    );

    // Sync if parent changes presetId externally
    React.useEffect(() => {
        const match = STRATEGY_PRESETS.find(p => p.id === presetId);
        if (match && match.id !== selectedPreset?.id) setSelectedPreset(match);
    }, [presetId]);

    const handleSelectPreset = (preset) => {
        setSelectedPreset(preset);
        onPresetChange?.(preset);
    };

    const compatiblePresets = STRATEGY_PRESETS.filter(p => p.assetTypes?.includes(symbolAssetType));

    const effectiveCapital = useCustom ? (parseFloat(customCapital) || 10000) : capital;
    const effectivePositionPct = Math.min(50, Math.max(1, positionPct));

    const RISK_COLOR = { LOW: 'text-emerald-400', MED: 'text-amber-400', HIGH: 'text-orange-400', EXTREME: 'text-rose-400', ADAPTIVE: 'text-cyan-400' };

    return (
    <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/82 backdrop-blur-md p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-cyan-500/25 bg-[#101116]/95 shadow-2xl shadow-cyan-950/40 overflow-hidden max-h-[95vh] overflow-y-auto">
            <div className="border-b border-white/10 bg-cyan-500/8 p-5">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl border border-cyan-400/30 bg-cyan-400/10 flex items-center justify-center">
                        <Target className="h-5 w-5 text-cyan-300" />
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">Mission Control Preflight</div>
                        <h2 className="mt-1 text-2xl font-black text-white">Run Trade Strategy</h2>
                    </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                    SOMA will prepare the thesis, run Deep Scan evidence, backtest/simulate the setup, validate gates, check paper broker readiness, then engage autonomous paper trading.
                </p>
            </div>
            <div className="p-5">
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded border border-white/5 bg-black/35 p-3">
                        <div className="text-[9px] uppercase tracking-wider text-zinc-600">Target</div>
                        <div className="mt-1 font-mono font-bold text-white">{symbol}</div>
                    </div>
                    <div className="rounded border border-white/5 bg-black/35 p-3">
                        <div className="text-[9px] uppercase tracking-wider text-zinc-600">Execution</div>
                        <div className={`mt-1 font-bold ${isDemoMode ? 'text-amber-300' : 'text-rose-300'}`}>{isDemoMode ? 'PAPER' : 'LIVE MODE SELECTED'}</div>
                    </div>
                    <div className="rounded border border-white/5 bg-black/35 p-3">
                        <div className="text-[9px] uppercase tracking-wider text-zinc-600">Market Data</div>
                        <div className={`mt-1 font-bold ${dataSource === 'REAL' ? 'text-emerald-300' : dataSource === 'SIMULATION' ? 'text-amber-300' : 'text-zinc-400'}`}>{dataSource || 'CONNECTING'}</div>
                    </div>
                </div>

                {/* Protocol / Preset Selector */}
                <div className="mt-3 rounded border border-cyan-500/15 bg-cyan-950/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-600">Active Protocol</div>
                        <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{compatiblePresets.length} compatible with {symbolAssetType}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {compatiblePresets.map(preset => (
                            <button
                                key={preset.id}
                                onClick={() => handleSelectPreset(preset)}
                                className={`rounded border px-2.5 py-2 text-left transition-all ${
                                    selectedPreset?.id === preset.id
                                        ? 'border-cyan-400/60 bg-cyan-400/10 ring-1 ring-cyan-400/30'
                                        : 'border-white/5 bg-black/25 hover:border-white/15 hover:bg-black/40'
                                }`}
                            >
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className={`text-[10px] font-bold ${selectedPreset?.id === preset.id ? 'text-cyan-300' : 'text-zinc-300'}`}>{preset.name}</span>
                                    <span className={`text-[8px] font-bold uppercase ${RISK_COLOR[preset.riskProfile] || 'text-zinc-500'}`}>{preset.riskProfile}</span>
                                </div>
                                <div className="text-[9px] text-zinc-600 leading-tight">{preset.description}</div>
                            </button>
                        ))}
                    </div>
                    {selectedPreset?.config && (
                        <div className="mt-2 grid grid-cols-4 gap-1">
                            <div className="bg-black/30 rounded p-1.5 text-center border border-white/5">
                                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Min Conf</div>
                                <div className="text-[10px] font-mono text-cyan-300">{(selectedPreset.config.minConfidence * 100).toFixed(0)}%</div>
                            </div>
                            <div className="bg-black/30 rounded p-1.5 text-center border border-white/5">
                                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Take Profit</div>
                                <div className="text-[10px] font-mono text-emerald-400">{(selectedPreset.config.takeProfitPct * 100).toFixed(0)}%</div>
                            </div>
                            <div className="bg-black/30 rounded p-1.5 text-center border border-white/5">
                                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Stop Loss</div>
                                <div className="text-[10px] font-mono text-rose-400">{(selectedPreset.config.stopLossPct * 100).toFixed(0)}%</div>
                            </div>
                            <div className="bg-black/30 rounded p-1.5 text-center border border-white/5">
                                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Cooldown</div>
                                <div className="text-[10px] font-mono text-zinc-400">{selectedPreset.config.cooldownSec}s</div>
                            </div>
                        </div>
                    )}
                    {selectedPreset && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                            {selectedPreset.strategies?.map(s => (
                                <span key={s.id} className="px-1.5 py-0.5 rounded text-[8px] bg-cyan-950/50 border border-cyan-500/20 text-cyan-400/80">{s.name}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Allocation Controls */}
                <div className="mt-3 rounded border border-cyan-500/15 bg-cyan-950/20 p-3">
                    <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-cyan-600">Trading Allocation</div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="mb-1.5 text-[9px] uppercase tracking-wider text-zinc-500">{isDemoMode ? 'Paper Capital' : 'Capital'}</div>
                            <div className="flex flex-wrap gap-1 mb-1.5">
                                {CAPITAL_PRESETS.map(p => (
                                    <button key={p} onClick={() => { setCapital(p); setUseCustom(false); }}
                                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors ${!useCustom && capital === p ? 'bg-cyan-400 text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}>
                                        ${p >= 1000 ? `${p/1000}k` : p}
                                    </button>
                                ))}
                            </div>
                            <input
                                type="number"
                                placeholder="Custom $"
                                value={customCapital}
                                onFocus={() => setUseCustom(true)}
                                onChange={e => { setCustomCapital(e.target.value); setUseCustom(true); }}
                                className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs font-mono text-white placeholder-zinc-600 focus:border-cyan-500/50 focus:outline-none"
                            />
                        </div>
                        <div>
                            <div className="mb-1.5 text-[9px] uppercase tracking-wider text-zinc-500">Max Position Size</div>
                            <div className="flex items-center gap-2 mb-2">
                                <input type="range" min="1" max="50" value={positionPct}
                                    onChange={e => setPositionPct(Number(e.target.value))}
                                    className="flex-1 accent-cyan-400 h-1" />
                                <span className="text-xs font-mono font-bold text-cyan-300 w-8 text-right">{effectivePositionPct}%</span>
                            </div>
                            <div className="text-[9px] text-zinc-600">
                                Max trade: <span className="text-zinc-400">${Math.round(effectiveCapital * effectivePositionPct / 100).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-3 rounded border border-white/5 bg-black/25 p-3 text-[11px] leading-relaxed text-zinc-400">
                    <div className="mb-2 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Automatic sequence</div>
                    <div>1. Fresh market bars → 2. Thesis → 3. Deep Scan → 4. Backtest/simulation → 5. Execution validation → 6. Paper autonomous start</div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                        <button onClick={onSettings} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                            Settings
                        </button>
                        <button onClick={onSkip} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                            Skip Strategy
                        </button>
                    </div>
                    <button onClick={() => onRun({ capital: effectiveCapital, maxPositionPct: effectivePositionPct / 100, preset: selectedPreset })} disabled={running}
                        className="rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
                        {running ? 'Running Preflight...' : 'Run Trade Strategy'}
                    </button>
                </div>
            </div>
        </div>
    </div>
    );
};

const MissionControlApp = ({ somaBackend, isConnected }) => {
    const missionControl = useTradingMission();
    // --- STATE MANAGEMENT ---
    const [mode, setMode] = useState(TradeMode.AUTONOMOUS);
    const [tradingActive, setTradingActive] = useState(false);
    const [selectedSymbol, setSelectedSymbol] = useState('BTC-USD');
    const [assetType, setAssetType] = useState(AssetType.CRYPTO);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
    const [isRadarCollapsed, setIsRadarCollapsed] = useState(false);
    const [decisionPanelTab, setDecisionPanelTab] = useState('decisions');
    const [activeTradeThesis, setActiveTradeThesis] = useState(null);

    // Demo/Live Mode State
    const [isDemoMode, setIsDemoMode] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [exchangeCredentialStatus, setExchangeCredentialStatus] = useState(null);
    const [sidebarTab, setSidebarTab] = useState('mission'); // 'mission' | 'agents' | 'learning' | 'debate' | 'backtest'
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // Training State (Lifted from DemoTrainingPanel)
    const [isTraining, setIsTraining] = useState(false);
    const [trainingStats, setTrainingStats] = useState(null);
    const [isTrainingLoading, setIsTrainingLoading] = useState(false);
    const [isTrainingMinimized, setIsTrainingMinimized] = useState(true);

    // Toast + modal state
    const [toasts, setToasts] = useState([]);
    const [confirmModal, setConfirmModal] = useState(null); // { title, body, verdict, onConfirm }
    const [sessionSummary, setSessionSummary] = useState(null);
    const [sessionStartTime, setSessionStartTime] = useState(null);
    const [tradeStrategyGateSkipped, setTradeStrategyGateSkipped] = useState(false);

    // Data freshness
    const [lastDataTime, setLastDataTime] = useState(null);
    const [dataAge, setDataAge] = useState(0);

    // Ask SOMA panel
    const [askSomaOpen, setAskSomaOpen] = useState(false);
    const [askSomaQuery, setAskSomaQuery] = useState('');
    const [askSomaResponse, setAskSomaResponse] = useState(null);
    const [askSomaLoading, setAskSomaLoading] = useState(false);
    const [conversationHealth, setConversationHealth] = useState(null);

    // Data State
    const [tickers, setTickers] = useState(INITIAL_TICKERS);
    const [activeStrategies, setActiveStrategies] = useState(STRATEGY_PRESETS[1].strategies); // Default to BTC Native
    const [currentPresetId, setCurrentPresetId] = useState('BTC_NATIVE');
    const [learnedPlaybook, setLearnedPlaybook] = useState(null);
    const [missionRuntime, setMissionRuntime] = useState(null);
    const [huntState, setHuntState] = useState(null);
    const [trades, setTrades] = useState([]);
    const [chartData, setChartData] = useState([]);
    const [timeframe, setTimeframe] = useState('1Min');
    const [dataSource, setDataSource] = useState('CONNECTING'); // 'REAL' | 'SIMULATION' | 'CONNECTING'
    const [visibleMarketStatus, setVisibleMarketStatus] = useState(null);
    const [missionPulse, setMissionPulse] = useState(null);
    const [missionPulseConnected, setMissionPulseConnected] = useState(false);
    const missionPulseAtRef = useRef(0);
    const performancePulseAtRef = useRef(0);

    const setRuntimeMode = (demoMode) => {
        setIsDemoMode(demoMode);
        setRiskMetrics(prev => demoMode
            ? { ...prev, initialBalance: 100000, walletBalance: 150000, equity: 100000 }
            : prev
        );
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        let ws = null;
        let reconnectTimer = null;
        let closed = false;

        const backendHost = window.location.port === '5173' ? 'localhost:3001' : window.location.host;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

        const connect = () => {
            try {
                ws = new WebSocket(`${protocol}://${backendHost}/ws`);
                ws.onopen = () => setMissionPulseConnected(true);
                ws.onclose = () => {
                    setMissionPulseConnected(false);
                    if (!closed) reconnectTimer = setTimeout(connect, 3000);
                };
                ws.onerror = () => {
                    setMissionPulseConnected(false);
                };
                ws.onmessage = event => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type !== 'mission_control_pulse') return;
                        missionPulseAtRef.current = Date.now();
                        setMissionPulse(message.payload || null);
                    } catch {
                        // Ignore malformed telemetry frames.
                    }
                };
            } catch {
                setMissionPulseConnected(false);
                if (!closed) reconnectTimer = setTimeout(connect, 3000);
            }
        };

        connect();
        return () => {
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            try { ws?.close(); } catch {}
        };
    }, []);

    const mapDecisionsToTradeStream = useCallback((decisions = []) => {
        return decisions
            .map(d => ({
                id: d.id,
                timestamp: d.timestamp,
                symbol: d.symbol || d.details?.symbol,
                side: d.action === 'BUY' || d.action === 'TAKE_PROFIT' ? 'BUY'
                    : d.action === 'SELL' || d.action === 'STOP_LOSS' ? 'SELL'
                    : d.action === 'HOLD' ? 'HOLD'
                    : d.action === 'BLOCKED' || d.action === 'SKIP' ? 'SKIP'
                    : d.action,
                price: d.price || d.fillPrice || 0,
                quantity: d.qty || 0,
                reason: `[${d.category}] ${d.reason?.slice(0, 80) || d.category}`,
                riskScore: d.confidence ? Math.round(d.confidence * 100) : 0,
                pnl: d.pnl || 0,
                status: d.category === 'TRADE' || d.category === 'PAPER' ? 'FILLED'
                    : d.category === 'MANAGE' ? 'MANAGED'
                    : d.action
            }));
    }, []);

    const applyPerformanceSummary = useCallback((summary = {}) => {
        if (summary.sharpe_ratio != null || summary.sortino_ratio != null || summary.max_drawdown_pct != null) {
            setRiskMetrics(prev => ({
                ...prev,
                sharpeRatio: summary.sharpe_ratio ?? prev.sharpeRatio,
                sortinoRatio: summary.sortino_ratio ?? prev.sortinoRatio,
                maxDrawdownPct: summary.max_drawdown_pct ?? prev.maxDrawdownPct
            }));
        }

        const lb = summary.agent_leaderboard || summary.agentLeaderboard;
        if (!lb?.length) return;
        setActiveStrategies(prev => prev.map(s => {
            const row = lb.find(r => r.agent_name === s.id || r.agent_name === s.name ||
                r.strategy === s.id || r.strategy === s.name);
            if (!row || !row.total_trades) return s;
            return {
                ...s,
                winRate: Math.round(((row.wins || 0) / (row.total_trades || 1)) * 100),
                pnl: row.total_pnl ?? s.pnl,
                profitFactor: row.profit_factor != null ? row.profit_factor.toFixed(2) : s.profitFactor
            };
        }));
    }, []);

    // Autonomous trading state
    const [autonomousStatus, setAutonomousStatus] = useState(null);

    // Live positions & orders from broker
    const [brokerPositions, setBrokerPositions] = useState([]);
    const [brokerOrders, setBrokerOrders] = useState([]);
    const [liveReadiness, setLiveReadiness] = useState(null); // Paper→live readiness report
    const [marketRegime, setMarketRegime] = useState(null); // MarketRegimeDetector state
    const learnedPlaybookHydratedRef = useRef(false);
    const manualPresetOverrideRef = useRef(false);

    // Risk State (switches between demo and real balances)
    const [riskMetrics, setRiskMetrics] = useState({
        initialBalance: 100000,  // Start with demo balance
        walletBalance: 150000,
        equity: 100000,
        dailyDrawdown: 0,
        maxDrawdownLimit: 5.0,
        netExposure: 0,
        sharpeRatio: null,
        sortinoRatio: null
    });

    // --- HELPERS ---
    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
    }, []);

    const refreshExchangeCredentialStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/exchange/credentials-status');
            const data = await response.json();
            if (data.success && data.status) {
                setExchangeCredentialStatus(data.status);
                return data.status;
            }
        } catch (error) {
            console.error('Failed to refresh exchange credential status:', error);
        }

        try {
            const response = await fetch('/api/alpaca/has-credentials');
            const data = await response.json();
            if (data.success) {
                const fallbackStatus = {
                    alpaca_paper: Boolean(data.hasPaperCredentials),
                    alpaca_live: Boolean(data.hasLiveCredentials)
                };
                setExchangeCredentialStatus(prev => ({ ...(prev || {}), ...fallbackStatus }));
                return fallbackStatus;
            }
        } catch (error) {
            console.error('Failed to refresh Alpaca credential fallback status:', error);
        }

        return null;
    }, []);

    useEffect(() => {
        refreshExchangeCredentialStatus();
    }, [refreshExchangeCredentialStatus]);

    const formatDuration = (ms) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    };

    const parseTradeNumber = (value) => {
        if (value == null) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    };

    const inferTradeDirection = (recommendation = '') => {
        const text = String(recommendation).toUpperCase();
        if (text.includes('BUY') || text.includes('LONG')) return 'BUY';
        if (text.includes('SELL') || text.includes('SHORT')) return 'SELL';
        return 'HOLD';
    };

    const buildQualityGates = (thesis) => ({
        canDeepScan: thesis.status === 'draft',
        canBacktest: ['enriched', 'simulated', 'paper_ready'].includes(String(thesis.status || '').toLowerCase()),
        canPaperTrade: ['paper_ready', 'paper_active'].includes(String(thesis.status || '').toLowerCase()),
        freshData: thesis.dataSource === 'REAL' || thesis.dataAgeSec == null || thesis.dataAgeSec < 120,
        hasEntry: thesis.entryPlan?.entry != null,
        hasStop: thesis.entryPlan?.stopLoss != null,
        hasTarget: thesis.entryPlan?.takeProfit != null,
        hasEvidence: (thesis.evidenceRefs || []).length > 0,
        riskDefined: thesis.entryPlan?.stopLoss != null || thesis.entryPlan?.maxLossUsd != null || thesis.risks?.length > 0
    });

    const persistTradeThesis = useCallback(async (thesis) => {
        if (!thesis) return null;
        try {
            const res = await fetch('/api/mission-control/thesis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(thesis)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to save trade thesis');
            setActiveTradeThesis(data.thesis);
            return data.thesis;
        } catch (error) {
            addToast(`Thesis save failed: ${error.message}`, 'warning');
            return thesis;
        }
    }, [addToast]);

    const getThesisBlockers = (thesis) => {
        if (!thesis) return ['no thesis'];
        const gates = thesis.qualityGates || {};
        const status = String(thesis.status || '').toLowerCase();
        const blockers = [];
        if (!['paper_ready', 'paper_active'].includes(status)) blockers.push('paper-ready status');
        if (!gates.freshData) blockers.push('fresh data');
        if (!gates.hasEntry) blockers.push('entry');
        if (!gates.hasStop) blockers.push('stop');
        if (!gates.hasTarget) blockers.push('target');
        if (!gates.hasEvidence) blockers.push('evidence');
        if (!gates.riskDefined) blockers.push('risk');
        if (!['BUY', 'SELL'].includes(String(thesis.entryPlan?.direction || '').toUpperCase())) blockers.push('direction');
        return blockers;
    };

    useEffect(() => {
        let cancelled = false;
        const loadMissionRuntime = async () => {
            try {
                const res = await fetch('/api/mission-control/runtime');
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled && data.success) setMissionRuntime(data.runtime || null);
            } catch {
                // Runtime is an enhancement; Mission Control can still run without this endpoint.
            }
        };
        const loadLearnedPlaybook = async () => {
            try {
                const res = await fetch('/api/soma/simulations/playbook-mc');
                if (!res.ok) return;
                const data = await res.json();
                const presets = Array.isArray(data.presets) ? data.presets : [];
                if (cancelled || !data.online || presets.length === 0) return;

                const learnedStrategies = presets.slice(0, 10).map(strategy => ({
                    ...strategy,
                    active: strategy.active !== false,
                    source: strategy.source || 'soma-learned-playbook',
                    lastExecution: strategy.lastExecution || (data.marketLab?.[0]?.updatedAt ? new Date(data.marketLab[0].updatedAt).toLocaleTimeString() : strategy.lastExecution),
                }));
                setLearnedPlaybook({
                    loadedAt: new Date().toISOString(),
                    stats: data.stats || {},
                    missionCouncil: data.missionCouncil || null,
                    marketLab: data.marketLab || [],
                    count: learnedStrategies.length,
                    best: data.marketLab?.[0] || null,
                });

                if (!manualPresetOverrideRef.current || currentPresetId === 'SOMA_LEARNED') {
                    setActiveStrategies(learnedStrategies);
                    setCurrentPresetId('SOMA_LEARNED');
                    if (!learnedPlaybookHydratedRef.current) {
                        learnedPlaybookHydratedRef.current = true;
                        addToast(`Loaded SOMA learned Mission Control council (${learnedStrategies.length})`, 'success');
                    }
                }
            } catch {
                // Mission Control remains usable with static presets.
            }
        };
        loadMissionRuntime();
        loadLearnedPlaybook();
        const t = setInterval(() => {
            loadMissionRuntime();
            loadLearnedPlaybook();
        }, 15000);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [addToast, currentPresetId]);

    // Track data age (updates every second)
    useEffect(() => {
        if (!lastDataTime) return;
        const updateAge = () => setDataAge(Math.floor((Date.now() - lastDataTime) / 1000));
        updateAge();
        const interval = setInterval(updateAge, 1000);
        return () => clearInterval(interval);
    }, [lastDataTime]);

    useEffect(() => {
        if (!missionPulse?.autonomous?.success) return;
        const decisions = missionPulse.autonomous.decisions || [];
        const statusData = {
            ...missionPulse.autonomous,
            _latestDecisions: decisions,
            missionControlRuntime: missionPulse.missionRuntime || missionPulse.autonomous.missionControlRuntime
        };
        setAutonomousStatus(statusData);
        if (statusData.openPositions) setBrokerPositions(statusData.openPositions);

        const tradeDecisions = mapDecisionsToTradeStream(decisions);
        if (tradeDecisions.length > 0) setTrades(tradeDecisions);

        const unrealizedPnl = (statusData.openPositions || []).reduce(
            (sum, p) => sum + (p.unrealizedPnl || 0),
            0
        );
        const realizedPnl = statusData.stats?.sessionPnL || 0;
        setRiskMetrics(prev => ({
            ...prev,
            equity: prev.initialBalance + unrealizedPnl + realizedPnl,
            netExposure: (statusData.openPositions || []).reduce(
                (sum, p) => sum + (p.marketValue || 0),
                0
            ),
            dailyDrawdown: Math.max(prev.dailyDrawdown,
                unrealizedPnl + realizedPnl < 0 && prev.initialBalance > 0
                    ? Math.abs((unrealizedPnl + realizedPnl) / prev.initialBalance) * 100
                    : 0
            )
        }));

        if (statusData.guardrailsState) {
            const gs = statusData.guardrailsState;
            setRiskMetrics(prev => ({
                ...prev,
                dailyDrawdown: prev.initialBalance > 0
                    ? Math.abs(gs.dailyLoss / prev.initialBalance) * 100
                    : prev.dailyDrawdown,
                maxDrawdownLimit: gs.config?.maxDailyLoss && prev.initialBalance > 0
                    ? (gs.config.maxDailyLoss / prev.initialBalance) * 100
                    : prev.maxDrawdownLimit
            }));
        }

        if (missionPulse.missionRuntime) setMissionRuntime(missionPulse.missionRuntime);
        if (missionPulse.strategyHunt) setHuntState(missionPulse.strategyHunt);
        if (missionPulse.scalping) setTrainingStats(missionPulse.scalping);
        if (missionPulse.performance) {
            performancePulseAtRef.current = Date.now();
            applyPerformanceSummary(missionPulse.performance);
        }
        if (missionPulse.tradeThesis?.symbol === selectedSymbol) {
            setActiveTradeThesis(missionPulse.tradeThesis);
        }
    }, [missionPulse, mapDecisionsToTradeStream, applyPerformanceSummary, selectedSymbol]);

    // Ask SOMA handler
    const handleAskSoma = useCallback(async () => {
        if (!askSomaQuery.trim() || askSomaLoading) return;
        setAskSomaLoading(true);
        setAskSomaResponse(null);
        try {
            const res = await fetch('/api/soma/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: askSomaQuery,
                    sessionId: 'mission-control-conversation',
                    context: {
                        source: 'mission-control',
                        symbol: selectedSymbol,
                        price: currentTicker?.price,
                        mode: isDemoMode ? 'paper' : 'live',
                        tradingActive,
                        pnl: autonomousStatus?.stats?.sessionPnL
                    }
                })
            });
            const data = await res.json();
            setAskSomaResponse(data.response || data.message || JSON.stringify(data));
            setConversationHealth(data.metadata?.conversation || null);
            setAskSomaQuery('');
        } catch (e) {
            setAskSomaResponse(`Error: ${e.message}`);
        } finally {
            setAskSomaLoading(false);
        }
    }, [askSomaQuery, askSomaLoading, selectedSymbol, isDemoMode, tradingActive, autonomousStatus]);

    // Fetch real account balance from Alpaca when switching to live mode
    const fetchRealBalance = async () => {
        try {
            const res = await fetch('/api/alpaca/account');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.data) {
                    const acct = data.data.account || {};
                    const equity = parseFloat(acct.equity) || 0;
                    const cash = parseFloat(acct.cash) || 0;
                    setRiskMetrics(prev => ({
                        ...prev,
                        initialBalance: equity,
                        walletBalance: cash,
                        equity: equity
                    }));
                    // Also update positions from account fetch
                    if (data.data.positions) {
                        setBrokerPositions(data.data.positions);
                    }
                }
            }
        } catch (error) {
            console.error('[MissionControl] Failed to fetch real balance:', error);
        }
    };

    // Hydrate ticker prices — try yfinance first (stocks + futures + crypto), Binance as crypto fallback
    useEffect(() => {
        // Primary: yfinance market data (same source as Simulation Suite)
        fetch('/api/soma/simulations/market-data')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) throw new Error('no data');
                const priceMap = {};
                // Crypto: yf uses BTC not BTC-USD
                for (const [id, info] of Object.entries(data.crypto || {})) {
                    if (info?.price) { priceMap[id] = info.price; priceMap[`${id}-USD`] = info.price; }
                }
                // Stocks
                for (const [id, info] of Object.entries(data.stocks || {})) {
                    if (info?.price) priceMap[id] = info.price;
                }
                // Futures: yf ES=F → MC uses ES1!
                const FUTURES_MAP = { ES: 'ES1!', NQ: 'NQ1!', CL: 'CL1!', GC: 'GC1!', SI: 'SI1!', ZB: 'ZB1!' };
                for (const [id, info] of Object.entries(data.futures || {})) {
                    if (info?.price) { priceMap[id] = info.price; if (FUTURES_MAP[id]) priceMap[FUTURES_MAP[id]] = info.price; }
                }
                if (!Object.keys(priceMap).length) throw new Error('empty');
                setTickers(prev => prev.map(t => {
                    const p = priceMap[t.symbol];
                    return p ? { ...t, price: p } : t;
                }));
            })
            .catch(() => {
                // Fallback: Binance for crypto only
                const cryptoSymbols = INITIAL_TICKERS.filter(t => t.type === 'crypto').map(t => t.symbol).slice(0, 15).join(',');
                fetch(`/api/binance/prices?symbols=${cryptoSymbols}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data?.prices) return;
                        setTickers(prev => prev.map(t => {
                            const p = data.prices[t.symbol];
                            return p ? { ...t, price: p } : t;
                        }));
                    })
                    .catch(() => {});
            });
    }, []);

    // Sync tradingActive with backend state on mount — engine may already be running
    useEffect(() => {
        fetch('/api/autonomous/status')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.isRunning) {
                    setTradingActive(true);
                    setIsTraining(true);
                    console.log('[MissionControl] Synced: autonomous engine already running');
                }
            })
            .catch(() => {}); // Backend offline — stay at default state
    }, []);

    // Poll broker positions & orders when trading is active
    // Also syncs RiskPanel: wallet balance, mark-to-market equity, net exposure, daily drawdown
    useEffect(() => {
        if (!tradingActive) return;

        const fetchBrokerData = async () => {
            try {
                const [posRes, ordRes] = await Promise.all([
                    fetch('/api/alpaca/account'),
                    fetch('/api/alpaca/orders?status=all&limit=20')
                ]);

                if (posRes.ok) {
                    const posData = await posRes.json();
                    if (posData.success && posData.data) {
                        const acct = posData.data.account || {};
                        const positions = posData.data.positions || [];

                        setBrokerPositions(positions);

                        if (acct.equity > 0) {
                            const totalMarketValue = positions.reduce((s, p) => s + (p.market_value || 0), 0);
                            const portfolioValue = acct.portfolio_value || acct.equity;
                            const lastEquity = acct.last_equity || portfolioValue;

                            const rawDailyDrawdown = lastEquity > 0 && acct.equity < lastEquity
                                ? ((lastEquity - acct.equity) / lastEquity) * 100
                                : 0;

                            setRiskMetrics(prev => {
                                // In paper/demo mode, equity is owned by the autonomous status pulse
                                // (initialBalance + sessionPnL + unrealizedPnl). Overwriting it here
                                // with the Alpaca account balance causes the equity display to flip
                                // between the two sources every 5s. Only update equity from broker
                                // when trading live against a real Alpaca account.
                                if (isDemoMode) {
                                    return { ...prev, netExposure: totalMarketValue, dailyDrawdown: Math.max(prev.dailyDrawdown, rawDailyDrawdown) };
                                }
                                return {
                                    ...prev,
                                    walletBalance: portfolioValue,
                                    equity: acct.equity,
                                    initialBalance: prev.initialBalance === 100000 && portfolioValue > 0
                                        ? portfolioValue
                                        : prev.initialBalance,
                                    netExposure: totalMarketValue,
                                    dailyDrawdown: Math.max(prev.dailyDrawdown, rawDailyDrawdown),
                                };
                            });
                        }
                    }
                }

                if (ordRes.ok) {
                    const ordData = await ordRes.json();
                    if (ordData.success && ordData.orders) {
                        setBrokerOrders(ordData.orders);
                    }
                }
            } catch (err) {
                // Silently fail — broker might not be connected
            }
        };

        fetchBrokerData();
        const interval = setInterval(fetchBrokerData, 5000); // 5s for near-real-time balance
        return () => clearInterval(interval);
    }, [tradingActive, isDemoMode]);

    // Fetch paper→live readiness report periodically
    useEffect(() => {
        const fetchReadiness = async () => {
            try {
                const res = await fetch('/api/learning/report');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.report) {
                        setLiveReadiness(data.report);
                    }
                }
            } catch (err) { /* ignore */ }
        };

        fetchReadiness();
        const interval = setInterval(fetchReadiness, 60000); // Every minute
        return () => clearInterval(interval);
    }, []);

    // Fetch account data immediately on mount (so users see their balance before engaging)
    useEffect(() => {
        fetchRealBalance();
    }, []);

    // Reset chart data when symbol changes so stale data from previous symbol is cleared
    useEffect(() => {
        setChartData([]);
        setDataSource('CONNECTING');
    }, [selectedSymbol]);

    // Fetch market regime from MarketRegimeDetector (if loaded)
    useEffect(() => {
        const fetchRegime = async () => {
            try {
                const res = await fetch(`/api/trading/regime?symbol=${selectedSymbol}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        setMarketRegime(data);
                    }
                }
            } catch (err) { /* ignore — detector may not be loaded */ }
        };

        fetchRegime();
        const interval = setInterval(fetchRegime, 30000); // Every 30s
        return () => clearInterval(interval);
    }, [selectedSymbol]);

    // ENGINE HOOK
    const engine = useMarketEngine(riskMetrics, isDemoMode, tickers, selectedSymbol);
    const missionPnl = useMemo(() => computeMissionPnl({
        riskMetrics,
        autonomousStatus,
        positions: brokerPositions,
        trades
    }), [riskMetrics, autonomousStatus, brokerPositions, trades]);

    // Derived State
    const currentTicker = tickers.find(t => t.symbol === selectedSymbol) || tickers[0];
    const filteredTickers = tickers.filter(t => t.type === assetType);
    // Derive market sentiment from real price change data (not random Math.random() sentiment field)
    const marketSentiment = tickers.filter(t => (t.changePercent || 0) > 0).length > tickers.length / 2 ? 'BULL' : 'BEAR';
    // 'alpaca_paper' | 'alpaca_live' | 'internal' — drives Portfolio panel source badge
    const paperModeSource = isDemoMode
        ? (exchangeCredentialStatus?.alpaca_paper ? 'alpaca_paper' : 'internal')
        : 'live';

    const createDraftThesisFromInterpret = useCallback(({ analysis, symbol, range, dataSource: source, quality, latestBar, error }) => {
        const price = parseTradeNumber(latestBar?.close ?? currentTicker?.price);
        const atmosphere = analysis?.atmosphere || 'UNKNOWN';
        const confidence = Math.max(
            0.35,
            Math.min(0.72, atmosphere === 'SURGE' || atmosphere === 'CASCADE' ? 0.62 : 0.48)
        );
        const direction = atmosphere === 'SURGE' ? 'BUY' : atmosphere === 'CASCADE' ? 'SELL' : 'HOLD';
        const dataAgeSec = latestBar?.timestamp ? Math.max(0, Math.round((Date.now() - latestBar.timestamp) / 1000)) : null;
        const thesis = {
            id: `thesis-${Date.now()}`,
            symbol: symbol || selectedSymbol,
            timeframe: range?.timeframe || timeframe,
            mode: isDemoMode ? 'paper' : 'live',
            source: 'interpret',
            facts: [
                `Latest ${symbol || selectedSymbol} price: ${price != null ? `$${price.toLocaleString()}` : 'unknown'}`,
                `Range: ${range?.label || 'current'} / ${range?.timeframe || timeframe}`,
                `Data source: ${source || dataSource}`,
                quality?.valid === false ? `Data quality issue: ${quality.issues?.[0] || 'unknown'}` : 'Data quality did not report a blocking issue'
            ].filter(Boolean),
            signals: [
                `Atmosphere: ${atmosphere}`,
                analysis?.poeticState,
                analysis?.protocolAdaptation ? `Protocol adaptation: ${analysis.protocolAdaptation}` : null
            ].filter(Boolean),
            assumptions: [
                'Interpret is a draft read, not an execution permission',
                source === 'SIMULATION' ? 'Current chart is using simulated or fallback market data' : 'Current chart is using live/provider market data',
                error ? `Interpret fallback used after error: ${error}` : null
            ].filter(Boolean),
            risks: [
                direction === 'HOLD' ? 'No directional edge established yet' : 'Direction requires Deep Scan evidence before paper entry',
                source === 'SIMULATION' ? 'Simulated data cannot pass live execution gates' : null
            ].filter(Boolean),
            entryPlan: {
                direction,
                entry: price,
                stopLoss: null,
                takeProfit: null,
                positionSize: null,
                maxLossUsd: null
            },
            confidence,
            invalidationCondition: 'Invalidate if fresh market data conflicts with this read or Deep Scan rejects the setup.',
            evidenceRefs: [],
            dataSource: source || dataSource,
            dataAgeSec,
            status: 'draft',
            updatedAt: Date.now()
        };
        thesis.qualityGates = buildQualityGates(thesis);
        setActiveTradeThesis(thesis);
        setDecisionPanelTab('thesis');
        persistTradeThesis(thesis);
        addToast(`Draft thesis created for ${thesis.symbol}`, 'success');
    }, [addToast, currentTicker?.price, dataSource, isDemoMode, persistTradeThesis, selectedSymbol, timeframe]);

    const enrichThesisFromDeepScan = useCallback((analysis) => {
        const strategy = analysis?.strategy || {};
        const deepScan = analysis?.deepScan || {};
        const direction = inferTradeDirection(strategy.recommendation);
        const enrichmentUsable = ['BUY', 'SELL'].includes(direction)
            && parseTradeNumber(strategy.stop_loss) != null
            && parseTradeNumber(strategy.take_profit) != null
            && (strategy.confidence ?? 0) >= 0.4;
        const evidenceRefs = [
            deepScan.evidenceId,
            deepScan.feedbackRecord?.id,
            deepScan.feedbackRecord?.parentEvidenceIds?.[0]
        ].filter(Boolean);
        const timeframeSignals = deepScan.timeframes
            ? Object.entries(deepScan.timeframes).map(([name, frame]) =>
                `${name}: ${frame.summary?.changePct != null ? `${frame.summary.changePct}%` : 'N/A'} change, RSI ${frame.summary?.rsi ?? '--'}`
            )
            : [];
        const altSignals = (deepScan.altSignals || []).map(signal => `${signal.label}: ${signal.state} - ${signal.detail}`);
        const newsSignals = (deepScan.news || []).slice(0, 3).map(item => `${item.source}: ${item.headline}`);
        setActiveTradeThesis(prev => {
            const base = prev?.symbol === selectedSymbol ? prev : null;
            const entry = parseTradeNumber(strategy.entry_price ?? currentTicker?.price);
            const stopLoss = parseTradeNumber(strategy.stop_loss);
            const takeProfit = parseTradeNumber(strategy.take_profit);
            const merged = {
                id: base?.id || `thesis-${Date.now()}`,
                symbol: selectedSymbol,
                timeframe: base?.timeframe || timeframe,
                mode: isDemoMode ? 'paper' : 'live',
                source: base ? `${base.source}+deep_scan` : 'deep_scan',
                facts: [
                    ...(base?.facts || []),
                    `Deep Scan recommendation: ${strategy.recommendation || 'N/A'}`,
                    deepScan.marketSimulation?.context?.count != null ? `Matched simulation runs: ${deepScan.marketSimulation.context.count}` : null,
                    deepScan.marketSimulation?.previousDeepScans?.count != null ? `Prior deep scans: ${deepScan.marketSimulation.previousDeepScans.count}` : null
                ].filter(Boolean),
                signals: [
                    ...(base?.signals || []),
                    ...timeframeSignals,
                    ...altSignals,
                    ...newsSignals
                ].filter(Boolean),
                assumptions: [
                    ...(base?.assumptions || []),
                    'Deep Scan evidence strengthens the thesis but still requires simulation/backtest before execution'
                ],
                risks: [
                    ...(base?.risks || []),
                    analysis?.risk?.notes,
                    analysis?.debate?.bear ? `Bear case: ${typeof analysis.debate.bear === 'string' ? analysis.debate.bear : JSON.stringify(analysis.debate.bear)}` : null
                ].filter(Boolean),
                entryPlan: {
                    direction,
                    entry,
                    stopLoss,
                    takeProfit,
                    positionSize: analysis?.risk?.position_size_recommendation || base?.entryPlan?.positionSize || null,
                    maxLossUsd: null
                },
                confidence: strategy.confidence ?? base?.confidence ?? 0,
                invalidationCondition: analysis?.risk?.invalidation || base?.invalidationCondition || 'Invalidate if evidence weakens or price violates the defined stop.',
                evidenceRefs: Array.from(new Set([...(base?.evidenceRefs || []), ...evidenceRefs])),
                dataSource,
                dataAgeSec: visibleMarketStatus?.ageSec ?? null,
                status: enrichmentUsable ? 'enriched' : 'enrichment_failed',
                updatedAt: Date.now()
            };
            merged.qualityGates = buildQualityGates(merged);
            persistTradeThesis(merged);
            return merged;
        });
        setDecisionPanelTab('thesis');
        if (enrichmentUsable) {
            addToast(`Deep Scan attached evidence to ${selectedSymbol} thesis`, 'success');
        } else {
            addToast(`Deep Scan returned weak signal for ${selectedSymbol} — no clear direction or missing levels. Thesis marked enrichment_failed.`, 'warning');
        }
    }, [addToast, currentTicker?.price, dataSource, isDemoMode, persistTradeThesis, selectedSymbol, timeframe, visibleMarketStatus?.ageSec]);

    const mapSymbolForBacktest = useCallback((symbol = selectedSymbol) => {
        const upper = String(symbol || '').toUpperCase();
        const map = {
            'BTC-USD': 'BTCUSDT', 'ETH-USD': 'ETHUSDT', 'SOL-USD': 'SOLUSDT',
            'DOGE-USD': 'DOGEUSDT', 'XRP-USD': 'XRPUSDT', 'ADA-USD': 'ADAUSDT',
            'AVAX-USD': 'AVAXUSDT', 'BNB-USD': 'BNBUSDT', 'LINK-USD': 'LINKUSDT'
        };
        return map[upper] || upper.replace(/[-/]/g, '');
    }, [selectedSymbol]);

    const fetchFreshBarsForThesis = useCallback(async () => {
        try {
            const res = await fetch(`/api/market/bars/${encodeURIComponent(selectedSymbol)}?timeframe=${encodeURIComponent(timeframe)}&limit=120`);
            const data = await res.json();
            if (!res.ok || !data.success || !Array.isArray(data.bars) || data.bars.length === 0) {
                throw new Error(data.error || 'market bars unavailable');
            }
            const latest = data.bars[data.bars.length - 1];
            return {
                bars: data.bars,
                latest,
                quality: data.quality || null,
                dataAgeSec: latest?.timestamp ? Math.max(0, Math.round((Date.now() - latest.timestamp) / 1000)) : null
            };
        } catch (error) {
            return { bars: chartData || [], latest: chartData?.[chartData.length - 1] || null, quality: null, dataAgeSec: visibleMarketStatus?.ageSec ?? null, error };
        }
    }, [chartData, selectedSymbol, timeframe, visibleMarketStatus?.ageSec]);

    const buildAutoThesis = useCallback(async (baseThesis = null) => {
        const fresh = await fetchFreshBarsForThesis();
        const bars = fresh.bars || [];
        const latest = fresh.latest || {};
        const first = bars[0] || {};
        const lastClose = parseTradeNumber(latest.close ?? latest.price ?? currentTicker?.price);
        const firstClose = parseTradeNumber(first.close ?? first.price ?? lastClose);
        const changePct = firstClose && lastClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
        const direction = baseThesis?.entryPlan?.direction && baseThesis.entryPlan.direction !== 'HOLD'
            ? baseThesis.entryPlan.direction
            : changePct >= 0 ? 'BUY' : 'SELL';
        const stopPct = direction === 'BUY' ? 0.985 : 1.015;
        const targetPct = direction === 'BUY' ? 1.03 : 0.97;
        const entry = parseTradeNumber(baseThesis?.entryPlan?.entry) ?? lastClose;
        const thesis = {
            ...(baseThesis || {}),
            id: baseThesis?.id || `thesis-${Date.now()}`,
            symbol: selectedSymbol,
            timeframe: baseThesis?.timeframe || timeframe,
            mode: isDemoMode ? 'paper' : 'live',
            source: baseThesis?.source || 'auto_prepare',
            facts: Array.from(new Set([
                ...(baseThesis?.facts || []),
                `Auto-prep latest ${selectedSymbol} price: ${entry != null ? `$${entry.toLocaleString()}` : 'unknown'}`,
                `Auto-prep range change: ${Number.isFinite(changePct) ? `${changePct.toFixed(2)}%` : 'unknown'}`,
                fresh.error ? `Fresh bar fallback: ${fresh.error.message}` : 'Fresh bars fetched for thesis preparation'
            ].filter(Boolean))),
            signals: Array.from(new Set([
                ...(baseThesis?.signals || []),
                `Auto-prep directional read: ${direction}`,
                `Recent slope: ${Number.isFinite(changePct) ? `${changePct.toFixed(2)}%` : 'unknown'}`
            ].filter(Boolean))),
            assumptions: Array.from(new Set([
                ...(baseThesis?.assumptions || []),
                'Auto-prep may create a paper-trading thesis, not live-money permission'
            ])),
            risks: Array.from(new Set([
                ...(baseThesis?.risks || []),
                'Auto-generated stop and target must be validated by backtest before paper session'
            ])),
            entryPlan: {
                ...(baseThesis?.entryPlan || {}),
                direction,
                entry,
                stopLoss: parseTradeNumber(baseThesis?.entryPlan?.stopLoss) ?? (entry != null ? Number((entry * stopPct).toFixed(4)) : null),
                takeProfit: parseTradeNumber(baseThesis?.entryPlan?.takeProfit) ?? (entry != null ? Number((entry * targetPct).toFixed(4)) : null),
                positionSize: baseThesis?.entryPlan?.positionSize || null,
                maxLossUsd: baseThesis?.entryPlan?.maxLossUsd || null
            },
            confidence: Math.max(baseThesis?.confidence || 0, Math.min(0.64, 0.46 + Math.abs(changePct || 0) / 100)),
            invalidationCondition: baseThesis?.invalidationCondition || 'Invalidate if fresh market data rejects the direction or price violates the stop.',
            evidenceRefs: baseThesis?.evidenceRefs || [],
            dataSource: fresh.error ? (baseThesis?.dataSource || dataSource) : 'REAL',
            dataAgeSec: fresh.dataAgeSec,
            status: baseThesis?.status || 'draft',
            updatedAt: Date.now()
        };
        thesis.qualityGates = buildQualityGates(thesis);
        return persistTradeThesis(thesis);
    }, [buildQualityGates, currentTicker?.price, dataSource, fetchFreshBarsForThesis, isDemoMode, persistTradeThesis, selectedSymbol, timeframe]);

    const deepScanThesisForAutoStart = useCallback(async (thesis) => {
        const response = await fetch('/api/finance/deep-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: selectedSymbol,
                activeProtocol: currentPresetId,
                assetType,
                dataSource: thesis?.dataSource || dataSource,
                tickerData: currentTicker,
                chartData,
                riskMetrics,
                presets: activeStrategies
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.analysis) {
            throw new Error(data.error || 'Deep Scan failed');
        }
        const analysis = data.analysis;
        const strategy = analysis.strategy || {};
        const deepScan = analysis.deepScan || {};
        const direction = inferTradeDirection(strategy.recommendation);
        const entry = parseTradeNumber(strategy.entry_price ?? thesis?.entryPlan?.entry ?? currentTicker?.price);
        const stopLoss = parseTradeNumber(strategy.stop_loss ?? thesis?.entryPlan?.stopLoss);
        const takeProfit = parseTradeNumber(strategy.take_profit ?? thesis?.entryPlan?.takeProfit);
        const evidenceRefs = [
            ...(thesis?.evidenceRefs || []),
            deepScan.evidenceId,
            deepScan.feedbackRecord?.id,
            deepScan.feedbackRecord?.parentEvidenceIds?.[0]
        ].filter(Boolean);
        const merged = {
            ...(thesis || {}),
            source: thesis?.source ? `${thesis.source}+deep_scan` : 'auto_deep_scan',
            facts: Array.from(new Set([
                ...(thesis?.facts || []),
                `Deep Scan recommendation: ${strategy.recommendation || 'N/A'}`,
                deepScan.marketSimulation?.context?.count != null ? `Matched simulation runs: ${deepScan.marketSimulation.context.count}` : null
            ].filter(Boolean))),
            signals: Array.from(new Set([
                ...(thesis?.signals || []),
                ...((deepScan.altSignals || []).map(signal => `${signal.label}: ${signal.state} - ${signal.detail}`)),
                ...((deepScan.news || []).slice(0, 3).map(item => `${item.source}: ${item.headline}`))
            ].filter(Boolean))),
            risks: Array.from(new Set([...(thesis?.risks || []), analysis?.risk?.notes].filter(Boolean))),
            entryPlan: {
                ...(thesis?.entryPlan || {}),
                direction: direction === 'HOLD' ? thesis?.entryPlan?.direction : direction,
                entry,
                stopLoss,
                takeProfit,
                positionSize: analysis?.risk?.position_size_recommendation || thesis?.entryPlan?.positionSize || null,
                maxLossUsd: thesis?.entryPlan?.maxLossUsd || null
            },
            confidence: strategy.confidence ?? thesis?.confidence ?? 0,
            invalidationCondition: analysis?.risk?.invalidation || thesis?.invalidationCondition,
            evidenceRefs: Array.from(new Set(evidenceRefs)),
            status: 'enriched',
            updatedAt: Date.now()
        };
        merged.qualityGates = buildQualityGates(merged);
        if (!['BUY', 'SELL'].includes(direction) || entry == null || stopLoss == null || takeProfit == null) {
            throw new Error(
                `Deep Scan returned insufficient data: ${[
                    !['BUY', 'SELL'].includes(direction) && 'no clear direction',
                    entry == null && 'missing entry',
                    stopLoss == null && 'missing stop',
                    takeProfit == null && 'missing target'
                ].filter(Boolean).join(', ')}`
            );
        }
        return persistTradeThesis(merged);
    }, [activeStrategies, assetType, buildQualityGates, chartData, currentPresetId, currentTicker, dataSource, persistTradeThesis, riskMetrics, selectedSymbol]);

    const runAutoBacktestForThesis = useCallback(async (thesis) => {
        const response = await fetch('/api/backtest/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: mapSymbolForBacktest(thesis.symbol),
                strategy: 'sma_crossover',
                strategyParams: { shortPeriod: 10, longPeriod: 20 },
                interval: timeframe === '1Min' ? '1h' : timeframe.toLowerCase(),
                initialCapital: 10000,
                feeRate: 0.001,
                maxPositionSize: 0.1,
                thesisId: thesis.id
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.sessionId) {
            throw new Error(data.error || 'Backtest failed to start');
        }
        const started = Date.now();
        while (Date.now() - started < 30000) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const poll = await fetch(`/api/backtest/${encodeURIComponent(data.sessionId)}`);
            const pollData = await poll.json();
            const session = pollData.session;
            if (!pollData.success || !session) continue;
            if (session.status === 'completed') {
                const statusRes = await fetch(`/api/mission-control/thesis/${encodeURIComponent(thesis.id)}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'simulated',
                        details: {
                            sessionId: data.sessionId,
                            metrics: session.metrics,
                            trades: session.trades,
                            strategy: 'sma_crossover',
                            interval: timeframe
                        }
                    })
                });
                const statusData = await statusRes.json();
                if (!statusRes.ok || !statusData.success) throw new Error(statusData.error || 'Thesis status update failed');
                const updated = statusData.thesis || thesis;
                setActiveTradeThesis(updated);
                return updated || thesis;
            }
            if (session.status === 'failed') throw new Error(session.error || 'Backtest failed');
        }
        throw new Error('Backtest timed out');
    }, [mapSymbolForBacktest, timeframe]);

    const prepareThesisForAutonomousStart = useCallback(async (initialBlockers = []) => {
        addToast(initialBlockers.length
            ? `Preparing thesis automatically: ${initialBlockers.join(', ')}.`
            : 'Preparing trade thesis automatically.',
            'info'
        );

        let thesis = await buildAutoThesis(activeTradeThesis);
        setActiveTradeThesis(thesis);
        setDecisionPanelTab('thesis');

        let blockers = getThesisBlockers(thesis);
        if (blockers.some(b => ['paper-ready status', 'fresh data', 'stop', 'target', 'evidence', 'direction'].includes(b))) {
            if (blockers.includes('evidence') || ['draft', 'enriched'].includes(String(thesis.status || '').toLowerCase())) {
                addToast('Auto-prep running Deep Scan for evidence.', 'info');
                thesis = await deepScanThesisForAutoStart(thesis);
                setActiveTradeThesis(thesis);
                blockers = getThesisBlockers(thesis);
            }
        }

        if (blockers.includes('paper-ready status')) {
            addToast('Auto-prep running backtest to move thesis toward paper-ready.', 'info');
            thesis = await runAutoBacktestForThesis(thesis);
            blockers = getThesisBlockers(thesis);
        }

        const validationRes = await fetch(`/api/mission-control/thesis/${encodeURIComponent(thesis.id)}/validate`, { method: 'POST' });
        const validationData = await validationRes.json();
        if (!validationRes.ok || !validationData.success) {
            throw new Error(validationData.error || 'server validation failed');
        }
        if (!validationData.validation?.executionReady) {
            const serverBlockers = validationData.validation?.blockers || blockers || ['server validation'];
            throw new Error(serverBlockers.join(', '));
        }

        const readyThesis = validationData.thesis || thesis;
        setActiveTradeThesis(readyThesis);
        addToast('Trade thesis prepared. Starting autonomous paper session.', 'success');
        return readyThesis;
    }, [activeTradeThesis, addToast, buildAutoThesis, deepScanThesisForAutoStart, runAutoBacktestForThesis]);

    // PnL Calculation (Restored)
    const symbolPnl = useMemo(() => {
        return trades
            .filter(t => t.symbol === selectedSymbol && t.pnl)
            .reduce((sum, t) => sum + (t.pnl || 0), 0);
    }, [trades, selectedSymbol]);

    useEffect(() => {
        let cancelled = false;
        const loadActiveThesis = async () => {
            try {
                const res = await fetch(`/api/mission-control/thesis?active=true&symbol=${encodeURIComponent(selectedSymbol)}`);
                const data = await res.json();
                if (!cancelled && data.success) setActiveTradeThesis(data.thesis || null);
            } catch {
                if (!cancelled) setActiveTradeThesis(null);
            }
        };
        loadActiveThesis();
        return () => { cancelled = true; };
    }, [selectedSymbol]);

    // --- REAL-TIME DATA (Alpaca Paper for Demo, Live for Real) ---
    useEffect(() => {
        if (!selectedSymbol) return;

        let intervalId;
        let consecutiveFailures = 0;

        const fetchRealTimeData = async () => {
            // Helper function to update chart and ticker state
            const updateMarketState = (bars) => {
                consecutiveFailures = 0; // Reset on success
                setChartData(bars);
                setLastDataTime(Date.now());
                const latestBar = bars[bars.length - 1];
                if (latestBar) {
                    setTickers(prev => prev.map(t => {
                        if (t.symbol === selectedSymbol) {
                            const prevPrice = t.price || latestBar.open;
                            const change = latestBar.close - prevPrice;
                            const changePercent = prevPrice > 0 ? (change / prevPrice) * 100 : 0;
                            return {
                                ...t,
                                price: latestBar.close,
                                change,
                                changePercent,
                                momentum: Math.max(-100, Math.min(100, (t.momentum || 0) * 0.8 + changePercent * 15)),
                                sentiment: change >= 0 ? 0.15 : -0.15
                            };
                        }
                        return t;
                    }));
                }
            };

            // STRATEGY 1: Fetch from SOMA Backend (always try — same origin)
            {
                try {
                    const barsRes = await fetch(`/api/market/bars/${selectedSymbol}?timeframe=${timeframe}&limit=100`);
                    if (barsRes.ok) {
                        const barsData = await barsRes.json();
                        if (barsData.success && barsData.bars && barsData.bars.length > 0) {
                            console.log(`[MarketData] Backend data received for ${selectedSymbol}`);
                            updateMarketState(barsData.bars);
                            setDataSource('REAL');
                            return;
                        }
                    } else {
                        console.warn(`[MarketData] Backend fetch failed: ${barsRes.status}`);
                    }
                } catch (error) {
                    console.warn('[MarketData] Backend unreachable:', error.message);
                }
            }

            // Direct Binance browser calls fail with CORS from localhost - skip to simulation
            consecutiveFailures++;
            if (consecutiveFailures <= 2) {
                console.log("[MarketData] Backend data unavailable. Using simulation.");
            }
            setDataSource('SIMULATION');
            setLastDataTime(Date.now());
            // STRATEGY 3: Simulation (Fallback)
            const basePrice = (currentTicker && currentTicker.price) || 64000;
            const now = Date.now();

            // Simulation Parameters
            const volatility = 0.002; // 0.2% per bar
            const cycleLength = 20; // Bars per trend cycle

            setChartData(prev => {
                let newChart;
                if (prev.length === 0) {
                    // Initialize with History
                    newChart = Array.from({ length: 100 }, (_, i) => {
                        const timeOffset = (100 - i);
                        // Combine Sine Wave (Trend) + Random Walk (Noise)
                        const trend = Math.sin(i / cycleLength) * (basePrice * 0.015);
                        const noise = (Math.random() - 0.5) * (basePrice * volatility * 10);
                        const price = basePrice + trend + noise;

                        return {
                            time: new Date(now - timeOffset * 60000).toLocaleTimeString(),
                            open: price - Math.random() * 50,
                            high: price + Math.random() * 80,
                            low: price - Math.random() * 80,
                            close: price,
                            volume: Math.floor(1000 + Math.random() * 9000 + (Math.abs(trend) * 0.1)) // Volume follows volatility
                        };
                    });
                } else {
                    // Add new bar based on previous close
                    const latest = prev[prev.length - 1];
                    const i = prev.length; // Monotonically increasing index for sine wave

                    // Trend Component (Sine Wave)
                    const trendDelta = (Math.sin(i / cycleLength) - Math.sin((i - 1) / cycleLength)) * (basePrice * 0.015);

                    // Noise Component
                    const noise = (Math.random() - 0.5) * (basePrice * volatility);

                    // Momentum Factor (continue direction with decay)
                    const momentum = (latest.close - latest.open) * 0.3;

                    const newClose = latest.close + trendDelta + noise + momentum;
                    const high = Math.max(latest.close, newClose) + Math.random() * (basePrice * 0.001);
                    const low = Math.min(latest.close, newClose) - Math.random() * (basePrice * 0.001);

                    newChart = [...prev.slice(-99), {
                        time: new Date().toLocaleTimeString(),
                        open: latest.close,
                        high: high,
                        low: low,
                        close: newClose,
                        volume: Math.floor(1000 + Math.random() * 9000)
                    }];
                }

                // Sync tickers with simulation for HUD accuracy
                const lastBar = newChart[newChart.length - 1];
                setTickers(tPrev => tPrev.map(t => {
                    if (t.symbol === selectedSymbol) {
                        return {
                            ...t,
                            price: lastBar.close,
                            change: lastBar.close - lastBar.open,
                            changePercent: ((lastBar.close - lastBar.open) / lastBar.open) * 100
                        };
                    }
                    return t;
                }));

                return newChart;
            });
        };

        // Initial fetch
        fetchRealTimeData();

        // Poll with backoff: 5s normally, slower when backend data is unavailable
        const poll = () => {
            const delay = consecutiveFailures > 2 ? 15000 : 5000; // Back off to 15s after 2 failures
            intervalId = setTimeout(() => {
                fetchRealTimeData().finally(poll);
            }, delay);
        };
        poll();

        return () => clearTimeout(intervalId);
    }, [selectedSymbol, timeframe]);

    // --- AUTONOMOUS TRADING: Poll decisions & status when active ---
    useEffect(() => {
        if (!tradingActive) return;

        let intervalId;

        const fetchAutonomousData = async () => {
            if (missionPulseConnected && Date.now() - missionPulseAtRef.current < 12000) {
                return;
            }
            try {
                // 1. Poll autonomous engine status + decisions
                const [statusRes, decisionsRes] = await Promise.allSettled([
                    fetch('/api/autonomous/status'),
                    fetch('/api/autonomous/decisions?limit=30')
                ]);

                let latestDecisions = [];

                if (decisionsRes.status === 'fulfilled' && decisionsRes.value.ok) {
                    const decData = await decisionsRes.value.json();
                    if (decData.success && decData.decisions) {
                        latestDecisions = decData.decisions;
                        // Map autonomous decisions into the trades stream format
                        // Include TRADE + MANAGE (real orders) and SIGNAL (engine thinking)
                        const tradeDecisions = mapDecisionsToTradeStream(decData.decisions);
                        if (tradeDecisions.length > 0) {
                            setTrades(tradeDecisions);
                        }
                    }
                }

                if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
                    const statusData = await statusRes.value.json();
                    if (statusData.success) {
                        // Attach latest decisions so the HUD Decision Feed can render them
                        statusData._latestDecisions = latestDecisions;
                        setAutonomousStatus(statusData);
                        // Update open positions from autonomous engine
                        if (statusData.openPositions) {
                            setBrokerPositions(statusData.openPositions);
                        }

                        // Live equity update: allocation + unrealized P&L + realized P&L
                        const unrealizedPnl = (statusData.openPositions || []).reduce(
                            (sum, p) => sum + (p.unrealizedPnl || 0), 0
                        );
                        const realizedPnl = statusData.stats?.sessionPnL || 0;
                        setRiskMetrics(prev => ({
                            ...prev,
                            equity: prev.initialBalance + unrealizedPnl + realizedPnl,
                            netExposure: (statusData.openPositions || []).reduce(
                                (sum, p) => sum + (p.marketValue || 0), 0
                            ),
                            dailyDrawdown: Math.max(prev.dailyDrawdown,
                                unrealizedPnl + realizedPnl < 0
                                    ? Math.abs((unrealizedPnl + realizedPnl) / prev.initialBalance) * 100
                                    : 0
                            )
                        }));

                        // Wire guardrails dailyLoss → RiskPanel dailyDrawdown (authoritative source)
                        if (statusData.guardrailsState) {
                            const gs = statusData.guardrailsState;
                            setRiskMetrics(prev => ({
                                ...prev,
                                dailyDrawdown: prev.initialBalance > 0
                                    ? Math.abs(gs.dailyLoss / prev.initialBalance) * 100
                                    : prev.dailyDrawdown,
                                maxDrawdownLimit: gs.config?.maxDailyLoss && prev.initialBalance > 0
                                    ? (gs.config.maxDailyLoss / prev.initialBalance) * 100
                                    : prev.maxDrawdownLimit
                            }));
                        }

                        // StrategyBrain reads live scores directly from autonomousStatus — no mutation needed

                        // Keep credential status badge in sync with actual Alpaca connection state
                        if (statusData.paperMode === false) {
                            // Alpaca is live — ensure badge reflects this
                            setExchangeCredentialStatus(prev => ({
                                ...(prev || {}),
                                alpaca_paper: true
                            }));
                        }
                    }
                }

                // Refresh Alpaca credential status every ~30s so the "Internal Paper" badge
                // clears as soon as Alpaca auto-connects after a server restart
                if (!missionPulseConnected) {
                    const alpacaRes = await fetch('/api/alpaca/status').catch(() => null);
                    if (alpacaRes?.ok) {
                        const alpacaData = await alpacaRes.json();
                        if (alpacaData?.status) {
                            setExchangeCredentialStatus(prev => ({
                                ...(prev || {}),
                                alpaca_paper: alpacaData.status.hasPaperCredentials || false,
                                alpaca_live: alpacaData.status.hasLiveCredentials || false,
                            }));
                        }
                    }
                }
            } catch (e) {
                console.error("Autonomous poll error:", e);
            }
        };

        fetchAutonomousData();
        intervalId = setInterval(fetchAutonomousData, 5000); // Poll every 5s

        return () => clearInterval(intervalId);
    }, [tradingActive, missionPulseConnected, mapDecisionsToTradeStream]);

    // Poll /api/performance/summary every 30s → merge real win rates into StrategyBrain cards + Sharpe/Sortino into RiskPanel
    useEffect(() => {
        const fetchPerf = async () => {
            if (missionPulseConnected && Date.now() - performancePulseAtRef.current < 45000) {
                return;
            }
            try {
                const res = await fetch('/api/performance/summary');
                if (!res.ok) return;
                const data = await res.json();
                const summary = data.summary || data.stats || {};
                applyPerformanceSummary(summary);
            } catch { /* non-fatal — StrategyBrain falls back to preset constants */ }
        };
        fetchPerf();
        const interval = setInterval(fetchPerf, 30000);
        return () => clearInterval(interval);
    }, [missionPulseConnected, applyPerformanceSummary]);

    // Live price ticks from LowLatencyEngine → update tickers + current chart candle
    useEffect(() => {
        const handleTick = ({ symbol, price }) => {
            if (!price || price <= 0) return;

            setTickers(prev => prev.map(t => {
                if (t.symbol !== symbol) return t;
                const prevPrice = t.price || price;
                const change = price - prevPrice;
                const changePercent = prevPrice > 0 ? (change / prevPrice) * 100 : 0;
                return {
                    ...t, price, change, changePercent,
                    // Keep momentum + sentiment in sync so MarketMap and orb reflect reality
                    momentum: Math.max(-100, Math.min(100, (t.momentum || 0) * 0.9 + changePercent * 10)),
                    sentiment: change >= 0 ? 0.15 : -0.15
                };
            }));

            if (symbol === selectedSymbol) {
                setLastDataTime(Date.now());
                setChartData(prev => {
                    if (!prev.length) return prev;
                    const last = prev[prev.length - 1];
                    return [
                        ...prev.slice(0, -1),
                        { ...last, close: price, high: Math.max(last.high ?? price, price), low: Math.min(last.low ?? price, price) }
                    ];
                });
            }
        };

        somaBackend.on('price_tick', handleTick);
        return () => somaBackend.off('price_tick', handleTick);
    }, [selectedSymbol]);

    // Keep simulation only if NOT connected
    useEffect(() => {
        if (isConnected) return; // Disable simulation when connected

        // Initialize Chart Data (Simulation Fallback)
        const simPrice = (currentTicker && currentTicker.price) || 64000;
        const initialChart = Array.from({ length: 60 }, (_, i) => ({
            time: new Date(Date.now() - (60 - i) * 1000).toLocaleTimeString(),
            open: simPrice,
            high: simPrice * 1.001,
            low: simPrice * 0.999,
            close: simPrice,
            volume: 1000 + Math.random() * 5000,
            prediction: simPrice * (1 + (Math.random() - 0.5) * 0.002)
        }));
        setChartData(initialChart);

        // ... (Original Simulation Logic would go here if we kept it, but clearing it for cleaner file)
    }, [selectedSymbol, isConnected]);


    // Training Logic
    useEffect(() => {
        let interval;
        if (isTraining) {
            const fetchStats = async () => {
                try {
                    const response = await fetch('/api/scalping/stats');
                    const data = await response.json();
                    if (data.success) setTrainingStats(data.stats);
                } catch (error) { console.error('Failed to fetch stats:', error); }
            };
            fetchStats();
            interval = setInterval(fetchStats, 5000);
        }
        return () => clearInterval(interval);
    }, [isTraining]);

    const captureSessionSummary = () => {
        if (!autonomousStatus?.stats || !sessionStartTime) return;
        setSessionSummary({
            duration: Date.now() - sessionStartTime,
            trades: missionPnl.trades,
            pnl: missionPnl.total,
            winRate: missionPnl.winRate || 0,
            errors: missionPnl.errors,
            symbol: selectedSymbol,
        });
    };

    const startAutonomousSession = async ({ requireBrokerCheck = false, source = 'autonomous', allocation = null } = {}) => {
        if (mode === TradeMode.AUTONOMOUS) return missionControl.command('run');
        setIsTrainingLoading(true);
        try {
            if (dataSource === 'SIMULATION') {
                addToast('Cannot start: market data is simulated. Wait for a live data connection before running autonomous sessions.', 'error');
                return false;
            }
            let thesisForStart = activeTradeThesis;
            const blockers = getThesisBlockers(thesisForStart);
            if (blockers.length > 0) {
                setDecisionPanelTab('thesis');
                try {
                    thesisForStart = await prepareThesisForAutonomousStart(blockers);
                } catch (error) {
                    addToast(`Autonomous start blocked. Auto-prep still missing: ${error.message}.`, 'warning');
                    return false;
                }
            }

            try {
                const validationRes = await fetch(`/api/mission-control/thesis/${encodeURIComponent(thesisForStart.id)}/validate`, { method: 'POST' });
                const validationData = await validationRes.json();
                if (!validationData.success || !validationData.validation?.executionReady) {
                    const serverBlockers = validationData.validation?.blockers || ['server validation'];
                    setDecisionPanelTab('thesis');
                    addToast(`Autonomous start blocked: ${serverBlockers.join(', ')}.`, 'warning');
                    return false;
                }
                thesisForStart = validationData.thesis || thesisForStart;
            } catch (error) {
                addToast(`Autonomous start blocked: could not validate thesis (${error.message}).`, 'warning');
                return false;
            }

            // Broker check only matters for live mode — paper/demo mode runs internally without Alpaca.
            if (requireBrokerCheck && !isDemoMode) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                try {
                    const statusRes = await fetch('/api/alpaca/status', { signal: controller.signal });
                    clearTimeout(timeout);
                    const statusData = await statusRes.json();
                    if (!statusData.success || !statusData.status?.connected) {
                        addToast('Alpaca not connected — add live keys in Settings, or enable Paper Mode.', 'warning');
                        setIsSettingsOpen(true);
                        return false;
                    }
                } catch (e) {
                    clearTimeout(timeout);
                    console.warn('[MissionControl] Alpaca status check failed, attempting start anyway');
                }
            }

            // Hard-block live trading if SOMA promotion gates say DO_NOT_GO_LIVE
            if (!isDemoMode && liveReadiness?.verdict?.recommendation === 'DO_NOT_GO_LIVE') {
                const issues = (liveReadiness.verdict.issues || []).slice(0, 2);
                addToast(`Live trading blocked: ${issues.join('; ') || 'promotion gates not met — check Mission Brief.'}`, 'error');
                setSidebarTab('mission');
                return false;
            }
            const engageRes = await fetch('/api/autonomous/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    preset: allocation?.preset?.id || currentPresetId,
                    thesisId: thesisForStart.id,
                    config: {
                        forcePaper: isDemoMode,
                        thesisId: thesisForStart.id,
                        launchSource: source,
                        ...(allocation?.capital      && { initialBalance:  allocation.capital }),
                        ...(allocation?.maxPositionPct && { maxPositionPct: allocation.maxPositionPct }),
                    }
                })
            });
            const engageData = await engageRes.json();

            if (!engageData.success && !engageData.error?.includes('Already running')) {
                addToast(`Failed to engage: ${engageData.error}`, 'error');
                return false;
            }

            setTradingActive(true);
            setIsTraining(true);
            setSessionStartTime(prev => prev || Date.now());
            fetch(`/api/mission-control/thesis/${encodeURIComponent(thesisForStart.id)}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'paper_active', details: { source, startedAt: new Date().toISOString() } })
            })
                .then(r => r.json())
                .then(data => { if (data.success && data.thesis) setActiveTradeThesis(data.thesis); })
                .catch(() => {});
            fetch('/api/lowlatency/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: [selectedSymbol] })
            }).catch(() => {});
            console.log(`[MissionControl] ${source} session ENGAGED for`, selectedSymbol);
            return true;
        } catch (e) {
            console.error('Start autonomous session error:', e);
            addToast(`Failed to start autonomous session: ${e.message}`, 'error');
            return false;
        } finally {
            setIsTrainingLoading(false);
        }
    };

    const stopAutonomousSession = async ({ includeScalping = true, showSummary = true, source = 'autonomous' } = {}) => {
        if (mode === TradeMode.AUTONOMOUS || missionControl.mission?.controlled) return missionControl.command('pause');
        setIsTrainingLoading(true);
        if (showSummary) captureSessionSummary();
        try {
            const stops = [
                fetch('/api/autonomous/stop', { method: 'POST' }),
                fetch('/api/lowlatency/stop', { method: 'POST' })
            ];
            if (includeScalping) stops.splice(1, 0, fetch('/api/scalping/stop', { method: 'POST' }));
            await Promise.allSettled(stops);
            setTradingActive(false);
            setIsTraining(false);
            setSessionStartTime(null);
            updateActiveThesisStatus('closed', {
                source,
                stoppedAt: new Date().toISOString(),
                includeScalping,
                sessionPnL: autonomousStatus?.stats?.sessionPnL ?? null,
                tradesExecuted: autonomousStatus?.stats?.tradesExecuted ?? null
            });
            console.log(`[MissionControl] ${source} session STOPPED`);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        } finally {
            setIsTrainingLoading(false);
        }
    };

    const handleStartTraining = () => startAutonomousSession({ requireBrokerCheck: true, source: 'autonomous training' });

    const handleStopTraining = () => stopAutonomousSession({ includeScalping: true, source: 'autonomous training' });

    // Training Button Component (Passed to GlobalControls)
    const trainingBrainButton = (isTrainingMinimized && mode !== TradeMode.MANUAL) ? (
        <button
            onClick={() => setIsTrainingMinimized(false)}
            className="w-10 h-10 bg-yellow-400/90 hover:bg-yellow-400 border-2 border-white/20 rounded-xl shadow-lg flex items-center justify-center transition-all hover:scale-110 animate-pulse group"
            title="Open Autonomous Training"
        >
            <Activity className="w-5 h-5 text-black group-hover:rotate-12 transition-transform" />
        </button>
    ) : null;

    const handlePresetSelect = (preset) => {
        manualPresetOverrideRef.current = true;
        setCurrentPresetId(preset.id);
        setActiveStrategies(preset.strategies);
    };

    const handleUpdateAllocation = (amount) => {
        setRiskMetrics(prev => ({ ...prev, initialBalance: amount, equity: amount })); // Reset session PnL on rellocation
    };

    const handleUpdateWallet = (amount) => {
        setRiskMetrics(prev => ({ ...prev, walletBalance: amount }));
    };

    const updateActiveThesisStatus = useCallback(async (status, details = {}) => {
        if (!activeTradeThesis?.id) return null;
        try {
            const res = await fetch(`/api/mission-control/thesis/${encodeURIComponent(activeTradeThesis.id)}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, details })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Thesis status update failed');
            setActiveTradeThesis(data.thesis);
            return data.thesis;
        } catch (error) {
            addToast(`Could not update thesis: ${error.message}`, 'warning');
            return null;
        }
    }, [activeTradeThesis?.id, addToast]);

    const markActiveThesisSimulated = useCallback(async (details = {}) => {
        const thesis = await updateActiveThesisStatus('simulated', details);
        if (thesis) {
            setDecisionPanelTab('thesis');
            addToast(thesis.status === 'paper_ready'
                ? 'Backtest passed gates. Thesis is paper-ready.'
                : 'Thesis marked simulated from backtest result.',
                'success'
            );
        }
    }, [addToast, updateActiveThesisStatus]);

    const toggleTrading = async () => {
        if (mode === TradeMode.AUTONOMOUS) {
            return missionControl.command(missionControl.mission?.desired === 'running' ? 'pause' : 'run');
        }
        if (!tradingActive) {
            await startAutonomousSession({ requireBrokerCheck: true, source: tradeStrategyGateSkipped ? 'manual engage' : 'run trade strategy' });
        } else {
            await stopAutonomousSession({ includeScalping: false, source: 'autonomous trading' });
        }
    };

    const killSwitch = async () => {
        if (mode === TradeMode.AUTONOMOUS) return missionControl.command('pause');
        setTradingActive(false);
        try {
            // Stop autonomous engine + hit both brokers in parallel
            const [autonomousResult, alpacaResult, binanceResult] = await Promise.allSettled([
                fetch('/api/autonomous/stop', { method: 'POST' }),
                fetch('/api/alpaca/emergency-stop', { method: 'POST' }).then(r => r.json()),
                fetch('/api/binance/emergency-stop', { method: 'POST' }).then(r => r.json())
            ]);

            const messages = [];
            if (alpacaResult.status === 'fulfilled' && alpacaResult.value.success) {
                messages.push(`Alpaca: ${alpacaResult.value.message}`);
            } else if (alpacaResult.status === 'rejected') {
                messages.push(`Alpaca: Could not reach broker`);
            }
            if (binanceResult.status === 'fulfilled' && binanceResult.value.success) {
                messages.push(`Binance: ${binanceResult.value.message}`);
            } else if (binanceResult.status === 'rejected') {
                messages.push(`Binance: Could not reach broker`);
            }

            setTrades([]);
            addToast(`EMERGENCY STOP — ${messages.length > 0 ? messages.join(' | ') : 'All positions halted'}`, 'warning');
        } catch (err) {
            addToast(`EMERGENCY STOP: Halted locally. ${err.message}`, 'warning');
        }
    };

    const handleModeToggle = async () => {
        if (mode === TradeMode.AUTONOMOUS) {
            addToast('SOMA Autopilot is paper-only. It cannot enable live trading.', 'info');
            return;
        }
        if (tradingActive) {
            const targetMode = isDemoMode ? 'LIVE' : 'DEMO';
            setConfirmModal({
                title: `Stop Engine Before ${targetMode} Switch`,
                body: `SOMA is currently running in ${isDemoMode ? 'DEMO/PAPER' : 'LIVE'} mode. The running engine must stop before switching modes so the UI and execution mode cannot drift apart.`,
                verdict: 'This will stop autonomous trading, clear the running session state, then switch the interface mode.',
                confirmLabel: `Stop and Switch to ${targetMode}`,
                confirmClassName: isDemoMode ? 'bg-rose-600 hover:bg-rose-500' : 'bg-cyan-600 hover:bg-cyan-500',
                onConfirm: async () => {
                    const stopped = await stopAutonomousSession({ includeScalping: true, source: 'mode switch' });
                    if (!stopped) {
                        addToast('Mode switch blocked because the engine did not stop cleanly.', 'error');
                        return;
                    }
                    if (isDemoMode) {
                        await requestLiveMode();
                    } else {
                        await switchToDemoMode();
                    }
                }
            });
            return;
        }

        if (!isDemoMode) {
            await switchToDemoMode();
        } else {
            await requestLiveMode();
        }
    };

    const switchToDemoMode = async () => {
        setRuntimeMode(true);
        addToast('Switched to DEMO/PAPER mode. Restart autonomous trading to apply the mode.', 'success');

        const status = exchangeCredentialStatus || await refreshExchangeCredentialStatus();
        if (status?.alpaca_paper) {
            try {
                const response = await fetch('/api/alpaca/connect-saved', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        credentialType: 'alpaca_paper'
                    })
                });
                const data = await response.json();
                if (data.success) console.log('Connected to Alpaca Paper Trading for demo');
            } catch (error) {
                console.error('Failed to connect paper trading:', error);
            }
        }
    };

    const requestLiveMode = async () => {
        const status = exchangeCredentialStatus || await refreshExchangeCredentialStatus();
        if (!status?.alpaca_live) {
            addToast('Configure and save Alpaca Live API keys in Settings before going live.', 'warning');
            setIsSettingsOpen(true);
            return;
        }

        let readinessWarning = '';
        try {
            const reportRes = await fetch('/api/learning/report');
            const reportData = await reportRes.json();
            if (reportData.success && reportData.report?.verdict) {
                const verdict = reportData.report.verdict;
                setLiveReadiness(reportData.report);

                if (verdict.recommendation === 'DO_NOT_GO_LIVE') {
                    readinessWarning = '\n\nSOMA RECOMMENDS: DO NOT GO LIVE\n' +
                        'Issues:\n' + (verdict.issues || []).map(i => `  - ${i}`).join('\n') +
                        '\n\nYou can still proceed, but SOMA has not validated this strategy yet.';
                } else if (verdict.recommendation === 'CAUTION') {
                    readinessWarning = '\n\nSOMA SAYS: PROCEED WITH CAUTION\n' +
                        'Issues:\n' + (verdict.issues || []).map(i => `  - ${i}`).join('\n');
                } else if (verdict.recommendation === 'GO_LIVE') {
                    readinessWarning = '\n\nSOMA SAYS: STRATEGY VALIDATED\n' +
                        'Strengths:\n' + (verdict.strengths || []).map(s => `  - ${s}`).join('\n');
                }
            }
        } catch (err) {
            readinessWarning = '\n\nCould not fetch readiness report.';
        }

        setConfirmModal({
            title: 'Switch to LIVE TRADING',
            body: 'You are about to trade with real money. The autonomous engine is stopped; restart it after switching if you intentionally want live execution.',
            verdict: readinessWarning.trim() || null,
            confirmLabel: 'Proceed with Live Trading',
            confirmClassName: 'bg-rose-600 hover:bg-rose-500',
            onConfirm: async () => {
                try {
                    const response = await fetch('/api/alpaca/connect-saved', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ credentialType: 'alpaca_live' })
                    });
                    const data = await response.json();
                    if (!data.success) {
                        addToast(`Could not connect saved Alpaca Live keys: ${data.error || 'unknown error'}`, 'error');
                        setIsSettingsOpen(true);
                        return;
                    }
                } catch (error) {
                    addToast(`Could not connect saved Alpaca Live keys: ${error.message}`, 'error');
                    setIsSettingsOpen(true);
                    return;
                }
                setRuntimeMode(false);
                fetchRealBalance();
            }
        });
    };

    const handleSaveKeys = (payload) => {
        if (payload?.status) {
            setExchangeCredentialStatus(prev => ({ ...(prev || {}), ...payload.status }));
        } else {
            refreshExchangeCredentialStatus();
        }
    };

    // MANUAL TRADE EXECUTION HANDLER
    const handleManualExecute = async (tradeOrder) => {
        console.log("MANUAL EXECUTION:", tradeOrder);

        try {
            // Execute trade via backend
            const response = await fetch('/api/finance/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: tradeOrder.symbol,
                    side: tradeOrder.side,
                    quantity: tradeOrder.quantity,
                    type: tradeOrder.type,
                    price: tradeOrder.price
                })
            });

            const result = await response.json();

            if (result.success) {
                // Add to trades stream with order confirmation
                setTrades(prev => [{
                    id: result.order.id,
                    timestamp: Date.now(),
                    symbol: result.order.symbol,
                    side: result.order.side,
                    price: tradeOrder.price,
                    quantity: result.order.quantity,
                    type: result.order.type,
                    reason: 'MANUAL_EXEC',
                    status: result.order.status,
                    riskScore: 0,
                    pnl: 0
                }, ...prev]);

                addToast(result.message, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Trade execution failed:', error);
            addToast(`Trade execution failed: ${error.message}`, 'error');
        }
    };

    return (
        <div className={`flex flex-col h-full bg-transparent text-zinc-200 font-sans overflow-hidden relative ${!isDemoMode && mode === TradeMode.MANUAL ? 'live-trading-mode' : ''
            }`}>

            {/* Live Trading Warning Border */}
            {!isDemoMode && mode === TradeMode.MANUAL && (
                <div className="absolute inset-0 pointer-events-none z-[100] rounded-xl border-4 border-rose-500 animate-pulse-glow" />
            )}

            {mode === TradeMode.MANUAL && !tradingActive && !tradeStrategyGateSkipped && (
                <TradeStrategyGate
                    symbol={selectedSymbol}
                    presetId={currentPresetId}
                    isDemoMode={isDemoMode}
                    dataSource={visibleMarketStatus?.source || dataSource}
                    running={isTrainingLoading}
                    onSettings={() => setIsSettingsOpen(true)}
                    onPresetChange={handlePresetSelect}
                    onSkip={() => {
                        setTradeStrategyGateSkipped(true);
                        addToast('Strategy preflight skipped. Manual Mission Control buttons are available.', 'info');
                    }}
                    onRun={async (allocation) => {
                        if (allocation?.preset) handlePresetSelect(allocation.preset);
                        const started = await startAutonomousSession({ requireBrokerCheck: true, source: 'run trade strategy', allocation });
                        if (started) setTradeStrategyGateSkipped(true);
                    }}
                />
            )}

            {/* Autonomous Training Panel — paper-only strategy lab controls */}
            {!isTrainingMinimized && mode === TradeMode.AUTONOMOUS && (
                <DemoTrainingPanel
                    isDemoMode={isDemoMode}
                    isTraining={isTraining}
                    stats={trainingStats}
                    loading={isTrainingLoading}
                    onStart={handleStartTraining}
                    onStop={handleStopTraining}
                    onMinimize={() => setIsTrainingMinimized(true)}
                />
            )}

            {/* 1. TOP BAR */}
            <GlobalControls
                mode={mode}
                setMode={(newMode) => {
                    console.log("[MissionControl] Switching Mode to:", newMode);
                    setMode(newMode);
                }}
                tradingActive={mode === TradeMode.AUTONOMOUS ? missionControl.mission?.desired === 'running' : tradingActive}
                missionBusy={missionControl.busy || !missionControl.mission || (Boolean(missionControl.error) && missionControl.mission?.desired !== 'running')}
                missionPaperOnly={mode === TradeMode.AUTONOMOUS}
                toggleTrading={toggleTrading}
                killSwitch={killSwitch}
                marketSentiment={marketSentiment}
                isDemoMode={mode === TradeMode.AUTONOMOUS || isDemoMode}
                onModeToggle={handleModeToggle}
                onOpenSettings={() => setIsSettingsOpen(true)}
                trainingButton={trainingBrainButton}
                marketRegime={marketRegime}
                // Global Asset Controls
                assetType={assetType}
                setAssetType={setAssetType}
                currentSymbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
            />

            {mode === TradeMode.AUTONOMOUS && <TradingMissionPanel control={missionControl}
                onInspectMarket={setSelectedSymbol} onOpenResearch={() => setSidebarTab('ecosystem')} />}

            {/* 2. MAIN WORKSPACE (SWITCHABLE) */}
            {mode === TradeMode.MANUAL ? (
                // MANUAL WORKSTATION LAYOUT
                <div className="flex-1 overflow-hidden bg-black/90 border border-white/5 m-0 relative z-10">
                    <ManualWorkstation
                        tickerData={currentTicker}
                        chartData={chartData}
                        onExecuteTrade={handleManualExecute}
                        accountBalance={riskMetrics.equity}
                        positions={brokerPositions}
                        orders={brokerOrders}
                        // New Props for Navigation
                        assetType={assetType}
                        setAssetType={setAssetType}
                        selectedSymbol={selectedSymbol}
                        setSelectedSymbol={setSelectedSymbol}
                        // Custom View Props
                        dataSource={dataSource}
                        activeProtocol={currentPresetId}
                    />
                </div>
            ) : (
                // AUTONOMOUS (L-SHAPED) LAYOUT
                <div className="flex-1 flex overflow-hidden bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl m-4 mt-0">

                    {/* --- LEFT SIDEBAR (COLLAPSIBLE) --- */}
                    <div className={`flex flex-col border-r border-white/5 h-full transition-all duration-300 relative ${sidebarCollapsed ? 'w-[32px]' : 'w-[305px]'}`}>

                        {/* Collapse toggle button */}
                        <button
                            onClick={() => setSidebarCollapsed(v => !v)}
                            className="absolute -right-4 top-1/2 -translate-y-1/2 z-[250] w-8 h-8 rounded-full bg-[#08090c] border border-cyan-400/30 flex items-center justify-center text-cyan-400 hover:text-cyan-200 hover:border-cyan-300/70 hover:shadow-[0_0_18px_rgba(34,211,238,0.45)] transition-all shadow-2xl"
                            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
                            </svg>
                        </button>

                        {sidebarCollapsed ? (
                            /* Collapsed: icon rail only */
                            <div className="flex flex-col items-center pt-2 gap-1 w-full">
                                {[
                                    { id: 'mission',  icon: Target,       title: 'Mission',   activeClass: 'bg-emerald-500/20 text-emerald-300'  },
                                    { id: 'ecosystem', icon: Activity, title: 'Trading Ecosystem', activeClass: 'bg-cyan-500/20 text-cyan-300' },
                                    { id: 'agents',   icon: Bot,          title: 'Agents',    activeClass: 'bg-indigo-500/20 text-indigo-300'   },
                                    { id: 'learning', icon: BookOpen,     title: 'Learning',  activeClass: 'bg-emerald-500/20 text-emerald-300'  },
                                    { id: 'debate',   icon: Swords,       title: 'Debate',    activeClass: 'bg-amber-500/20 text-amber-300'      },
                                    { id: 'backtest', icon: BarChart2,    title: 'Backtest',  activeClass: 'bg-violet-500/20 text-violet-300'    },
                                    { id: 'alerts',   icon: Bell,         title: 'Alerts',    activeClass: 'bg-orange-500/20 text-orange-300'    },
                                    { id: 'sim',      icon: FlaskConical, title: 'Sim Intel', activeClass: 'bg-fuchsia-500/20 text-fuchsia-300'  },
                                    { id: 'journal',  icon: ScrollText,   title: 'Journal',   activeClass: 'bg-cyan-500/20 text-cyan-300'       },
                                    { id: 'hunt',     icon: Trophy,       title: 'Strat Hunt', activeClass: 'bg-amber-500/20 text-amber-300'     },
                                ].map(({ id, icon: Icon, title, activeClass }) => (
                                    <button key={id} title={title}
                                        onClick={() => { setSidebarTab(id); setSidebarCollapsed(false); }}
                                        className={`w-7 h-7 rounded flex items-center justify-center transition-all ${sidebarTab === id ? activeClass : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'}`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                    </button>
                                ))}
                            </div>
                        ) : (
                        <>
                        {/* Strategy Brain / Learning Dashboard / Debate Arena tabs */}
                        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                            {/* Toggle Tabs */}
                            <div className="flex flex-wrap border-b border-white/5 bg-black/20 overflow-visible relative z-30">
                                {[
                                    { id: 'mission',  icon: Target,       title: 'Thesis Brief', activeClass: 'bg-emerald-500/20 text-emerald-300 border-b-2 border-emerald-500'   },
                                    { id: 'ecosystem', icon: Activity, title: 'Trading Ecosystem', activeClass: 'bg-cyan-500/20 text-cyan-300 border-b-2 border-cyan-500' },
                                    { id: 'agents',   icon: Bot,          title: 'Agents',        activeClass: 'bg-indigo-500/20 text-indigo-300 border-b-2 border-indigo-500'     },
                                    { id: 'learning', icon: BookOpen,     title: 'Learning',      activeClass: 'bg-emerald-500/20 text-emerald-300 border-b-2 border-emerald-500'   },
                                    { id: 'debate',   icon: Swords,       title: 'Debate',        activeClass: 'bg-amber-500/20 text-amber-300 border-b-2 border-amber-500'         },
                                    { id: 'backtest', icon: BarChart2,    title: 'Backtest',      activeClass: 'bg-violet-500/20 text-violet-300 border-b-2 border-violet-500'      },
                                    { id: 'alerts',   icon: Bell,         title: 'Alerts',        activeClass: 'bg-orange-500/20 text-orange-300 border-b-2 border-orange-500'      },
                                    { id: 'sim',      icon: FlaskConical, title: 'Sim Intel',     activeClass: 'bg-fuchsia-500/20 text-fuchsia-300 border-b-2 border-fuchsia-500'   },
                                    { id: 'journal',  icon: ScrollText,   title: 'Lifecycle Trail', activeClass: 'bg-cyan-500/20 text-cyan-300 border-b-2 border-cyan-500'          },
                                    { id: 'hunt',     icon: Trophy,       title: 'Strategy Hunt',   activeClass: 'bg-amber-500/20 text-amber-300 border-b-2 border-amber-500'         },
                                ].map(({ id, icon: Icon, title, activeClass }) => (
                                    <button key={id}
                                        title={title}
                                        aria-label={title}
                                        onClick={() => setSidebarTab(id)}
                                        className={`group relative flex-1 flex items-center justify-center py-2 transition-all ${sidebarTab === id ? activeClass : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        <span className="pointer-events-none absolute left-1/2 bottom-full z-[200] mb-2 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-zinc-950 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                                            {title}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-hidden">
                                {sidebarTab === 'ecosystem' ? (
                                    <div className="h-full overflow-y-auto custom-scrollbar"><TradingEcosystemPanel initialSymbol={selectedSymbol} /></div>
                                ) : sidebarTab === 'mission' ? (
                                    <MissionBriefPanel
                                        isDemoMode={isDemoMode}
                                        tradingActive={tradingActive}
                                        selectedSymbol={selectedSymbol}
                                        riskMetrics={riskMetrics}
                                        missionRuntime={missionRuntime}
                                        learnedPlaybook={learnedPlaybook}
                                        liveReadiness={liveReadiness}
                                        marketRegime={marketRegime}
                                        dataSource={dataSource}
                                        autonomousStatus={autonomousStatus}
                                        positions={brokerPositions}
                                        currentPresetId={currentPresetId}
                                        onOpenBacktest={() => setSidebarTab('backtest')}
                                        onOpenSim={() => setSidebarTab('sim')}
                                        onOpenJournal={() => setSidebarTab('journal')}
                                    />
                                ) : sidebarTab === 'learning' ? (
                                    <div className="h-full overflow-y-auto custom-scrollbar p-3">
                                        <LearningDashboard isDemo={isDemoMode} />
                                    </div>
                                ) : sidebarTab === 'debate' ? (
                                    <div className="h-full overflow-hidden">
                                        <DebateArena
                                            symbol={selectedSymbol}
                                            marketData={currentTicker}
                                            onDecision={(d) => addToast(`SOMA debate: ${d?.action || 'concluded'} ${selectedSymbol}`, 'info')}
                                        />
                                    </div>
                                ) : sidebarTab === 'backtest' ? (
                                    <div className="h-full overflow-hidden">
                                        <BacktestPanel
                                            selectedSymbol={selectedSymbol}
                                            activeThesis={activeTradeThesis}
                                            onThesisSimulated={markActiveThesisSimulated}
                                        />
                                    </div>
                                ) : sidebarTab === 'alerts' ? (
                                    <div className="h-full overflow-hidden">
                                        <AlertsPanel
                                            somaBackend={somaBackend}
                                            onAlertTriggered={(alert) => addToast(`ALERT: ${alert.label || alert.symbol} triggered @ $${alert.triggeredPrice?.toFixed(2)}`, 'warning')}
                                        />
                                    </div>
                                ) : sidebarTab === 'sim' ? (
                                    <div className="h-full overflow-hidden">
                                        <SimIntelPanel onDeployStrategies={(strategies) => {
                                            manualPresetOverrideRef.current = false;
                                            setCurrentPresetId('SOMA_LEARNED');
                                            setActiveStrategies(strategies);
                                            addToast(`Loaded ${strategies.length} trained strategies from SOMA playbook`, 'success');
                                        }} />
                                    </div>
                                ) : sidebarTab === 'journal' ? (
                                    <div className="h-full overflow-hidden">
                                        <LifecycleJournalPanel />
                                    </div>
                                ) : sidebarTab === 'hunt' ? (
                                    <div className="h-full overflow-hidden">
                                        {missionControl.mission?.controlled
                                            ? <p className="p-3 text-xs text-zinc-400">Autopilot owns the paper lifecycle. Its audit and current selection are shown above; legacy strategy hunting is suspended.</p>
                                            : <StrategyHuntPanel huntState={huntState} />}
                                    </div>
                                ) : (
                                    <StrategyBrain strategies={activeStrategies} autonomousStatus={autonomousStatus} learnedPlaybook={learnedPlaybook} missionRuntime={missionRuntime} />
                                )}
                            </div>
                        </div>
                        {/* Market Monitor (P&L/Storm) - Fixed Height */}
                        <div className="h-[200px] border-t border-white/5 shrink-0">
                            <MarketMonitor engine={engine} pnlSummary={missionPnl} />
                        </div>
                        </>
                        )}
                    </div>

                    {/* --- RIGHT CONTENT (FLEX) --- */}
                    <div className="flex-1 flex flex-col min-w-0 h-full">

                        {/* TOP GRID (Chart/Command/Risk) */}
                        <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-0 min-h-0">
                            {/* Center Col: Chart & Command */}
                            <div className="flex-1 lg:col-span-8 border-r border-white/5 relative flex flex-col min-h-0">
                                {/* Chart Area - Auto resize based on remaining space */}
                                <div className="flex-1 relative border-b border-white/5 transition-all duration-300">
                                    <CustomMarketView
                                        selectedSymbol={selectedSymbol}
                                        data={chartData}
                                        dataSource={dataSource}
                                        activeProtocol={currentPresetId}
                                        onDataStatus={setVisibleMarketStatus}
                                        onInterpretAnalysis={createDraftThesisFromInterpret}
                                    />
                                    {/* Data freshness badge */}
                                    {(visibleMarketStatus?.lastDataTime || lastDataTime) && (
                                        <div className={`absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono border backdrop-blur-sm
                                            ${(visibleMarketStatus?.source || dataSource) === 'SIMULATION' ? 'bg-amber-900/60 border-amber-500/30 text-amber-300' :
                                              (visibleMarketStatus?.ageSec ?? dataAge) < 30 ? 'bg-emerald-900/60 border-emerald-500/30 text-emerald-300' :
                                              (visibleMarketStatus?.ageSec ?? dataAge) < 120 ? 'bg-amber-900/60 border-amber-500/30 text-amber-300' :
                                              'bg-rose-900/60 border-rose-500/30 text-rose-300'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${(visibleMarketStatus?.source || dataSource) === 'SIMULATION' ? 'bg-amber-400 animate-pulse' : (visibleMarketStatus?.ageSec ?? dataAge) < 30 ? 'bg-emerald-400' : (visibleMarketStatus?.ageSec ?? dataAge) < 120 ? 'bg-amber-400 animate-pulse' : 'bg-rose-400 animate-pulse'}`} />
                                            {(visibleMarketStatus?.source || dataSource) === 'SIMULATION' ? 'SIMULATED' : `${visibleMarketStatus?.ageSec ?? dataAge}s ago`}
                                        </div>
                                    )}
                                    {visibleMarketStatus?.fallbackReason && (
                                        <div className="absolute top-9 right-2 z-10 max-w-[320px] rounded-md border border-amber-500/30 bg-amber-950/75 px-2 py-1 text-[10px] font-mono text-amber-200 backdrop-blur-sm shadow-lg">
                                            DATA FALLBACK: {visibleMarketStatus.fallbackReason}
                                        </div>
                                    )}
                                    {!tradingActive && (
                                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
                                            <div className="text-center p-3 border border-white/10 bg-[#18181b] rounded-lg shadow-2xl pointer-events-auto">
                                                <h2 className="text-xl font-bold text-white mb-1">STANDBY</h2>
                                                <button onClick={toggleTrading} className="px-4 py-1 bg-soma-accent text-black font-bold text-sm rounded hover:bg-cyan-300 transition-colors">
                                                    ENGAGE SYSTEM
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {/* Command Center */}
                                <div className="h-[220px] overflow-hidden shrink-0">
                                    <CommandPanel
                                        currentSymbol={selectedSymbol}
                                        onSymbolSelect={setSelectedSymbol}
                                        currentPresetId={currentPresetId}
                                        onPresetSelect={handlePresetSelect}
                                        assetType={assetType}
                                        setAssetType={setAssetType}
                                        onAnalyze={() => setIsAnalysisOpen(true)}
                                    />
                                </div>

                                {/* Ask SOMA Panel */}
                                <div className={`border-t border-white/5 shrink-0 overflow-hidden transition-all duration-300 ${askSomaOpen ? 'h-[185px]' : 'h-[30px]'}`}>
                                    <button
                                        onClick={() => setAskSomaOpen(v => !v)}
                                        className="w-full h-[30px] flex items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                                    >
                                        <MessageSquare className="w-3 h-3" />
                                        Ask SOMA
                                        {conversationHealth?.version && <span className="ml-2 text-[9px] font-normal text-cyan-400" title={`Recall: ${conversationHealth.memoryStatus}; ${conversationHealth.memoryCount} recalled items; ${conversationHealth.landmarks} conversation notes. This reports context delivery, not trading accuracy.`}>Shared voice · {conversationHealth.continuityTurns} prior turns{conversationHealth.scoped ? '' : ' · session only'}</span>}
                                        <div className="ml-auto">
                                            {askSomaOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                                        </div>
                                    </button>
                                    {askSomaOpen && (
                                        <div className="flex flex-col h-[155px] px-3 pb-3 gap-2">
                                            <div className="flex-1 overflow-y-auto text-xs text-zinc-300 bg-black/30 rounded p-2 custom-scrollbar min-h-0 border border-white/5">
                                                {askSomaLoading ? (
                                                    <span className="text-zinc-500 italic animate-pulse">SOMA is thinking...</span>
                                                ) : askSomaResponse ? (
                                                    <span className="whitespace-pre-wrap">{askSomaResponse}</span>
                                                ) : (
                                                    <span className="text-zinc-600 italic">Ask SOMA about {selectedSymbol} — market conditions, strategy, risk...</span>
                                                )}
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <input
                                                    value={askSomaQuery}
                                                    onChange={e => setAskSomaQuery(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAskSoma()}
                                                    placeholder={`Ask about ${selectedSymbol}...`}
                                                    className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-soma-accent/50"
                                                />
                                                <button
                                                    onClick={handleAskSoma}
                                                    disabled={askSomaLoading || !askSomaQuery.trim()}
                                                    className="px-3 py-1 bg-soma-accent/20 hover:bg-soma-accent/30 text-soma-accent text-xs font-bold rounded transition-colors disabled:opacity-40 flex items-center"
                                                >
                                                    <Send className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Col: Trade Stream & Risk */}
                            <div className="flex-1 lg:col-span-4 flex flex-col h-full overflow-hidden border-t lg:border-t-0 border-white/5">
                                <div className="h-1/2 border-b border-white/5 overflow-hidden">
                                    <div className="h-full flex flex-col bg-[#151518]/40">
                                        <div className="flex border-b border-white/5 bg-black/20">
                                            {[
                                                { id: 'decisions', label: 'Decision Stream', icon: Activity },
                                                { id: 'thesis', label: 'Trade Thesis', icon: Target },
                                                { id: 'portfolio', label: 'Portfolio', icon: Wallet },
                                                { id: 'evidence', label: 'Evidence Brief', icon: Database },
                                                { id: 'timeline', label: 'Evidence Timeline', icon: ScrollText },
                                            ].map(({ id, label, icon: Icon }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => setDecisionPanelTab(id)}
                                                    className={`group relative flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[9px] font-bold uppercase tracking-wide transition-colors ${decisionPanelTab === id ? 'text-cyan-300 bg-cyan-500/10' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'}`}
                                                    title={label}
                                                >
                                                    <Icon className="w-3.5 h-3.5" />
                                                    <span className="hidden xl:inline truncate">{label}</span>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex-1 min-h-0 overflow-hidden">
                                            {decisionPanelTab === 'decisions' ? (
                                                <TradeStream trades={trades} embedded />
                                            ) : decisionPanelTab === 'thesis' ? (
                                                <TradeThesisPanel thesis={activeTradeThesis} />
                                            ) : decisionPanelTab === 'portfolio' ? (
                                                <PortfolioPanel
                                                    riskMetrics={riskMetrics}
                                                    positions={brokerPositions}
                                                    orders={brokerOrders}
                                                    trades={trades}
                                                    isDemoMode={isDemoMode}
                                                    autonomousStatus={autonomousStatus}
                                                    paperModeSource={paperModeSource}
                                                />
                                            ) : decisionPanelTab === 'evidence' ? (
                                                <EvidenceBriefPanel
                                                    symbol={selectedSymbol}
                                                    missionRuntime={missionRuntime}
                                                    autonomousStatus={autonomousStatus}
                                                />
                                            ) : (
                                                <EvidenceTimelinePanel symbol={selectedSymbol} />
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="h-1/2 overflow-hidden">
                                    <RiskPanel
                                        readOnly={mode === TradeMode.AUTONOMOUS}
                                        metrics={riskMetrics}
                                        onUpdateAllocation={handleUpdateAllocation}
                                        onUpdateWallet={handleUpdateWallet}
                                        autonomousStatus={autonomousStatus}
                                        positions={brokerPositions}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* BOTTOM PANEL — Live Trading HUD */}
                        <div className={`border-t border-white/5 bg-[#0a0a0c]/80 overflow-hidden relative transition-all duration-300 ease-in-out ${isRadarCollapsed ? 'h-[32px]' : 'h-[180px] shrink-0'}`}>

                            {/* COLLAPSED STATE */}
                            <div
                                className={`absolute inset-0 flex items-center justify-between px-4 cursor-pointer hover:bg-white/5 transition-all z-50 ${isRadarCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                onClick={() => setIsRadarCollapsed(false)}
                            >
                                <div className="flex items-center gap-3">
                                    <Activity className={`w-4 h-4 ${tradingActive ? 'text-emerald-400 animate-pulse' : 'text-soma-accent'}`} />
                                    <span className="text-xs font-bold text-soma-accent uppercase tracking-widest">
                                        {tradingActive ? 'AUTONOMOUS ENGINE ACTIVE' : 'Trading HUD'}
                                    </span>
                                    {autonomousStatus?.stats && (
                                        <span className="text-[10px] font-mono text-zinc-500">
                                            {autonomousStatus.stats.tradesExecuted} trades | {autonomousStatus.stats.signalsHold} holds
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <ChevronUp className="w-4 h-4" />
                                </div>
                            </div>

                            {/* EXPANDED: Live Trading HUD */}
                            <div className={`w-full h-full flex transition-opacity duration-300 ${isRadarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>

                                {/* Left: Autonomous Status */}
                                <div className="w-[240px] border-r border-white/5 p-3 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Engine</h4>
                                        <button onClick={() => setIsRadarCollapsed(true)} className="p-0.5 rounded hover:bg-white/10 text-zinc-600 hover:text-white">
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded border ${tradingActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/50 border-white/5'}`}>
                                        <div className={`w-2 h-2 rounded-full ${tradingActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                                        <span className={`text-xs font-bold ${tradingActive ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                            {tradingActive ? 'RUNNING' : 'STANDBY'}
                                        </span>
                                    </div>
                                    {autonomousStatus?.stats && (() => {
                                        const lastConfidence = autonomousStatus.lastSignal?.confidence ?? null;
                                        const minConfidence = autonomousStatus.config?.minConfidence || autonomousStatus.guardrailsState?.config?.minConfidence || null;
                                        return (
                                        <div className="grid grid-cols-2 gap-1.5">
                                            <div className="bg-black/40 rounded p-1.5 border border-white/5">
                                                <div className="text-[8px] text-zinc-600">TRADES</div>
                                                <div className="text-sm font-mono font-bold text-white">{autonomousStatus.stats.tradesExecuted}</div>
                                            </div>
                                            <div className="bg-black/40 rounded p-1.5 border border-white/5">
                                                <div className="text-[8px] text-zinc-600">TOTAL P&L</div>
                                                <div className={`text-sm font-mono font-bold ${pnlTextColor(missionPnl.total)}`}>
                                                    {missionPnl.total >= 0 ? '+' : ''}{formatMoney(missionPnl.total)}
                                                </div>
                                            </div>
                                            <div className="bg-black/40 rounded p-1.5 border border-white/5">
                                                <div className="text-[8px] text-zinc-600">UNREALIZED</div>
                                                <div className={`text-sm font-mono font-bold ${pnlTextColor(missionPnl.unrealized)}`}>
                                                    {missionPnl.unrealized >= 0 ? '+' : ''}{formatMoney(missionPnl.unrealized)}
                                                </div>
                                            </div>
                                            <div className="bg-black/40 rounded p-1.5 border border-white/5">
                                                <div className="text-[8px] text-zinc-600">ERRORS</div>
                                                <div className={`text-sm font-mono ${autonomousStatus.stats.errors > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>{autonomousStatus.stats.errors}</div>
                                            </div>
                                            <div className="col-span-2 bg-black/40 rounded p-1.5 border border-white/5">
                                                <div className="flex justify-between text-[8px] text-zinc-600">
                                                    <span>LAST SIGNAL</span>
                                                    <span>{autonomousStatus.lastSignal?.action || 'NONE'}</span>
                                                </div>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <div className="flex-1 h-1 bg-zinc-900 rounded overflow-hidden">
                                                        <div
                                                            className={`h-full ${lastConfidence != null && minConfidence != null && lastConfidence >= minConfidence ? 'bg-emerald-400' : 'bg-blue-400'}`}
                                                            style={{ width: `${Math.max(0, Math.min(100, (lastConfidence || 0) * 100))}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[9px] font-mono text-zinc-400">
                                                        {lastConfidence != null ? Math.round(lastConfidence * 100) : '--'}%
                                                        {minConfidence != null ? ` / ${Math.round(minConfidence * 100)}%` : ''}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })()}
                                    <AgenticProofPanel compact />
                                </div>

                                {/* Center: Open Positions */}
                                <div className="flex-1 border-r border-white/5 p-3 overflow-y-auto custom-scrollbar">
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Open Positions</h4>
                                    {brokerPositions.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-[100px] text-zinc-600 text-xs italic text-center px-4">
                                            <span>No open positions</span>
                                            {autonomousStatus?.lastSignal && (
                                                <span className="mt-1 text-[10px] text-zinc-500 not-italic">
                                                    Last signal was {autonomousStatus.lastSignal.action}; confidence has not cleared the paper entry gate.
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {brokerPositions.map((pos, i) => (
                                                <div key={i} className="flex items-center justify-between bg-black/30 rounded px-2 py-1.5 border border-white/5 hover:border-white/10 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${pos.side === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                                            {(pos.side || 'long').toUpperCase()}
                                                        </span>
                                                        <span className="text-xs font-mono font-bold text-white">{pos.symbol}</span>
                                                        <span className="text-[10px] text-zinc-500">{pos.qty} @ ${pos.entryPrice?.toFixed(2) || pos.avg_entry_price || '—'}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`text-xs font-mono font-bold ${(pos.unrealizedPnl || parseFloat(pos.unrealized_pl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                            {(pos.unrealizedPnl || parseFloat(pos.unrealized_pl) || 0) >= 0 ? '+' : ''}
                                                            ${(pos.unrealizedPnl || parseFloat(pos.unrealized_pl) || 0).toFixed(2)}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Right: Decision Feed (recent non-trade decisions) */}
                                <div className="w-[320px] p-3 overflow-y-auto custom-scrollbar">
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Decision Feed</h4>
                                    {(!autonomousStatus || !tradingActive) ? (
                                        <div className="flex items-center justify-center h-[100px] text-zinc-600 text-xs italic">Engage autonomous mode to see decisions</div>
                                    ) : (
                                        <div className="space-y-1">
                                            {(autonomousStatus._latestDecisions || []).slice(0, 8).map((d, i) => (
                                                <div key={i} className="text-[10px] px-2 py-1 rounded bg-black/30 border-l-2" style={{
                                                    borderColor: d.action === 'BUY' ? '#34d399' : d.action === 'SELL' ? '#f87171' : d.action === 'HOLD' ? '#60a5fa' : d.action === 'BLOCKED' || d.action === 'FAIL' ? '#f59e0b' : '#3f3f46'
                                                }}>
                                                    <div className="flex justify-between">
                                                        <span className="font-bold text-zinc-300">{d.category} → {d.action}</span>
                                                        <span className="text-zinc-600">{new Date(d.timestamp).toLocaleTimeString()}</span>
                                                    </div>
                                                    <div className="text-zinc-500 truncate">{d.reason}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>

                </div>
            )}

            {/* MODALS */}
            <AIAnalysisModal
                isOpen={isAnalysisOpen}
                onClose={() => setIsAnalysisOpen(false)}
                symbol={selectedSymbol}
                tickerData={currentTicker}
                chartData={chartData}
                allTickers={filteredTickers}
                riskMetrics={riskMetrics}
                presets={STRATEGY_PRESETS}
                activeProtocol={currentPresetId}
                assetType={assetType}
                dataSource={visibleMarketStatus?.source || dataSource}
                onAnalysisComplete={enrichThesisFromDeepScan}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onSaveKeys={handleSaveKeys}
            />

            {/* ===== TOAST NOTIFICATIONS ===== */}
            {toasts.length > 0 && (
                <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-[200] pointer-events-none">
                    {toasts.map(t => (
                        <div key={t.id} className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-xl border pointer-events-auto max-w-sm animate-fade-in
                            ${t.type === 'success' ? 'bg-emerald-900/95 border-emerald-500/50 text-emerald-200' :
                              t.type === 'error' ? 'bg-rose-900/95 border-rose-500/50 text-rose-200' :
                              t.type === 'warning' ? 'bg-amber-900/95 border-amber-500/50 text-amber-200' :
                              'bg-zinc-800/95 border-white/10 text-zinc-200'}`}>
                            {t.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> :
                             t.type === 'error' ? <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> :
                             t.type === 'warning' ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> :
                             <MessageSquare className="w-4 h-4 shrink-0 mt-0.5" />}
                            <span className="text-xs leading-relaxed">{t.message}</span>
                            <button onClick={() => setToasts(prev => prev.filter(tt => tt.id !== t.id))} className="ml-auto text-current opacity-40 hover:opacity-100 transition-opacity">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ===== CONFIRM MODAL (Live Trading) ===== */}
            {confirmModal && (
                <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-[300] p-4">
                    <div className="bg-[#18181b] border border-amber-500/40 rounded-xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-start gap-3 mb-5">
                            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold text-white">{confirmModal.title}</h2>
                                <p className="text-sm text-zinc-300 mt-1">{confirmModal.body}</p>
                                {confirmModal.verdict && (
                                    <pre className="mt-3 p-3 bg-black/50 rounded text-xs text-zinc-400 whitespace-pre-wrap border border-white/5 max-h-[200px] overflow-y-auto custom-scrollbar">{confirmModal.verdict}</pre>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setConfirmModal(null)} className="px-4 py-2 text-sm rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 transition-colors">
                                Cancel
                            </button>
                            <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} className={`px-4 py-2 text-sm rounded-lg text-white font-bold transition-colors ${confirmModal.confirmClassName || 'bg-rose-600 hover:bg-rose-500'}`}>
                                {confirmModal.confirmLabel || 'Proceed with Live Trading'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== SESSION SUMMARY MODAL ===== */}
            {sessionSummary && (
                <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-[300] p-4">
                    <div className="bg-[#18181b] border border-white/10 rounded-xl shadow-2xl max-w-sm w-full p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-lg font-bold text-white">Session Complete</h2>
                            <button onClick={() => setSessionSummary(null)} className="p-1 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
                            <Clock className="w-3 h-3" />
                            {sessionSummary.symbol} · {formatDuration(sessionSummary.duration)}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-black/40 rounded-lg p-3 border border-white/5 col-span-2">
                                <div className="text-[10px] text-zinc-600 uppercase mb-1">Net P&L</div>
                                <div className={`text-3xl font-mono font-bold ${sessionSummary.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {sessionSummary.pnl >= 0 ? '+' : ''}${sessionSummary.pnl.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
                                <div className="text-[10px] text-zinc-600 uppercase">Trades</div>
                                <div className="text-2xl font-mono font-bold text-white">{sessionSummary.trades}</div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
                                <div className="text-[10px] text-zinc-600 uppercase">Errors</div>
                                <div className={`text-2xl font-mono font-bold ${sessionSummary.errors > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{sessionSummary.errors}</div>
                            </div>
                            {sessionSummary.winRate > 0 && (
                                <div className="bg-black/40 rounded-lg p-3 border border-white/5 col-span-2">
                                    <div className="text-[10px] text-zinc-600 uppercase">Win Rate</div>
                                    <div className="text-2xl font-mono font-bold text-white">{(sessionSummary.winRate * 100).toFixed(0)}%</div>
                                </div>
                            )}
                        </div>
                        <button onClick={() => setSessionSummary(null)} className="mt-4 w-full py-2 text-sm rounded-lg bg-soma-accent/10 hover:bg-soma-accent/20 text-soma-accent font-bold transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MissionControlApp;
