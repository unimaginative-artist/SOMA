import React, { useEffect, useState } from 'react';
import { X, Brain, Cpu, AlertTriangle, Terminal, Sparkles, TrendingUp, TrendingDown, Shield, BarChart3, MessageSquare } from 'lucide-react';

export const AIAnalysisModal = ({
    isOpen,
    onClose,
    symbol,
    tickerData,
    chartData,
    allTickers,
    riskMetrics,
    presets
}) => {
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [thinkingStep, setThinkingStep] = useState(0);
    const [duration, setDuration] = useState(null);

    useEffect(() => {
        if (isOpen) {
            generateAnalysis();
        } else {
            setAnalysis(null);
            setError(null);
            setLoading(false);
            setDuration(null);
        }
    }, [isOpen]);

    // Thinking steps animation while waiting for real API
    useEffect(() => {
        if (loading) {
            const interval = setInterval(() => {
                setThinkingStep(prev => (prev + 1) % 6);
            }, 1200);
            return () => clearInterval(interval);
        }
    }, [loading]);

    const generateAnalysis = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/finance/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Analysis failed (${response.status})`);
            }

            const data = await response.json();

            if (data.success && data.analysis) {
                setAnalysis(data.analysis);
                setDuration(data.analysis.duration);
            } else {
                throw new Error(data.error || 'No analysis returned');
            }
        } catch (err) {
            console.error('[AIAnalysis]', err);
            setError(err.message || 'Failed to generate analysis');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const thinkingMessages = [
        "DISPATCHING AI SWARM AGENTS...",
        "RESEARCHER: FETCHING MARKET DATA...",
        "QUANT: RUNNING TECHNICAL INDICATORS...",
        "DEBATERS: BULL VS BEAR ARGUMENTS...",
        "RISK AGENT: EVALUATING EXPOSURE...",
        "STRATEGIST: SYNTHESIZING VERDICT..."
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-3xl bg-soma-950 border border-soma-accent/50 rounded-lg shadow-[0_0_50px_rgba(0,240,255,0.15)] flex flex-col max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-soma-800 bg-soma-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-soma-accent/10 rounded-full border border-soma-accent/30">
                            <Brain className={`w-5 h-5 text-soma-accent ${loading ? 'animate-pulse' : ''}`} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-wider flex items-center gap-2">
                                SOMA DEEP SCAN
                            </h2>
                            <div className="text-[10px] text-soma-accent font-mono flex items-center gap-2">
                                <span>TARGET: {symbol}</span>
                                <span className="w-1 h-1 rounded-full bg-soma-accent"></span>
                                <span>{loading ? 'AI SWARM ACTIVE' : duration ? `COMPLETED IN ${(duration / 1000).toFixed(1)}s` : 'READY'}</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-soma-800 rounded text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 font-mono relative min-h-[400px]">
                    {loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6">
                            <div className="relative">
                                <div className="absolute inset-0 bg-soma-accent blur-xl opacity-20 animate-pulse"></div>
                                <Cpu className="w-16 h-16 text-soma-accent animate-[spin_3s_linear_infinite]" />
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-bold text-white animate-pulse">ANALYZING {symbol}</h3>
                                <div className="text-xs font-mono text-soma-accent tracking-widest">
                                    {thinkingMessages[thinkingStep]}
                                </div>
                            </div>
                            <div className="w-64 h-1 bg-soma-900 rounded-full overflow-hidden">
                                <div className="h-full bg-soma-accent animate-pulse" style={{ width: `${((thinkingStep + 1) / 6) * 100}%`, transition: 'width 0.5s' }}></div>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-soma-danger space-y-4">
                            <AlertTriangle className="w-12 h-12" />
                            <p className="text-lg font-bold">ANALYSIS FAILED</p>
                            <p className="text-sm text-slate-400 max-w-md text-center">{error}</p>
                            <button
                                onClick={generateAnalysis}
                                className="px-4 py-2 bg-soma-danger/10 border border-soma-danger rounded hover:bg-soma-danger/20 transition-colors font-bold text-xs"
                            >
                                RETRY ANALYSIS
                            </button>
                        </div>
                    ) : analysis ? (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-2 text-soma-success mb-4 pb-2 border-b border-soma-800/50">
                                <Sparkles className="w-4 h-4" />
                                <span className="text-xs font-bold tracking-widest">STRATEGIC DIRECTIVE GENERATED</span>
                            </div>

                            {/* Thesis */}
                            {analysis.thesis && (
                                <Section icon={<Brain className="w-4 h-4" />} title="DIRECTOR THESIS" color="text-purple-400">
                                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{analysis.thesis}</p>
                                </Section>
                            )}

                            {/* Strategy Verdict */}
                            {analysis.strategy && (
                                <Section icon={<TrendingUp className="w-4 h-4" />} title="STRATEGY VERDICT" color="text-soma-accent">
                                    <div className="grid grid-cols-2 gap-3">
                                        <Stat label="Recommendation" value={analysis.strategy.recommendation} highlight />
                                        <Stat label="Confidence" value={`${Math.round((analysis.strategy.confidence || 0) * 100)}%`} />
                                        {analysis.strategy.entry_price && <Stat label="Entry" value={`$${analysis.strategy.entry_price}`} />}
                                        {analysis.strategy.stop_loss && <Stat label="Stop Loss" value={analysis.strategy.stop_loss} />}
                                        {analysis.strategy.take_profit && <Stat label="Take Profit" value={analysis.strategy.take_profit} />}
                                    </div>
                                    {analysis.strategy.rationale && (
                                        <p className="text-xs text-slate-400 mt-3 leading-relaxed">{analysis.strategy.rationale}</p>
                                    )}
                                </Section>
                            )}

                            {/* Quant */}
                            {analysis.quant && (
                                <Section icon={<BarChart3 className="w-4 h-4" />} title="QUANT ANALYSIS" color="text-blue-400">
                                    <div className="grid grid-cols-2 gap-3">
                                        <Stat label="Strategy" value={analysis.quant.strategy} />
                                        {analysis.quant.technical_indicators?.rsi != null && (
                                            <Stat label="RSI" value={typeof analysis.quant.technical_indicators.rsi === 'number' ? analysis.quant.technical_indicators.rsi.toFixed(1) : String(analysis.quant.technical_indicators.rsi)} />
                                        )}
                                        {analysis.quant.backtest_results?.total_return != null && (
                                            <Stat label="Backtest Return" value={`${analysis.quant.backtest_results.total_return}%`} />
                                        )}
                                        {analysis.quant.backtest_results?.win_rate != null && (
                                            <Stat label="Win Rate" value={`${analysis.quant.backtest_results.win_rate}%`} />
                                        )}
                                    </div>
                                </Section>
                            )}

                            {/* Risk */}
                            {analysis.risk && (
                                <Section icon={<Shield className="w-4 h-4" />} title="RISK ASSESSMENT" color="text-amber-400">
                                    <div className="grid grid-cols-2 gap-3">
                                        <Stat label="Risk Score" value={`${analysis.risk.score}/100`} />
                                        <Stat label="Max Drawdown" value={analysis.risk.max_drawdown_limit} />
                                        <Stat label="Position Size" value={analysis.risk.position_size_recommendation} />
                                    </div>
                                    {analysis.risk.notes && (
                                        <p className="text-xs text-slate-400 mt-2">{analysis.risk.notes}</p>
                                    )}
                                </Section>
                            )}

                            {/* Sentiment */}
                            {analysis.sentiment && (
                                <Section icon={<TrendingDown className="w-4 h-4" />} title="SENTIMENT" color="text-green-400">
                                    <div className="grid grid-cols-3 gap-3">
                                        <Stat label="Score" value={(analysis.sentiment.score || 0).toFixed(2)} />
                                        <Stat label="Label" value={analysis.sentiment.label} />
                                        <Stat label="Social Volume" value={analysis.sentiment.social_volume} />
                                    </div>
                                </Section>
                            )}

                            {/* Debate */}
                            {analysis.debate && (
                                <Section icon={<MessageSquare className="w-4 h-4" />} title="BULL vs BEAR DEBATE" color="text-orange-400">
                                    {analysis.debate.bull && (
                                        <div className="mb-3">
                                            <span className="text-xs text-green-400 font-bold">BULL:</span>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{typeof analysis.debate.bull === 'string' ? analysis.debate.bull : JSON.stringify(analysis.debate.bull)}</p>
                                        </div>
                                    )}
                                    {analysis.debate.bear && (
                                        <div>
                                            <span className="text-xs text-red-400 font-bold">BEAR:</span>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{typeof analysis.debate.bear === 'string' ? analysis.debate.bear : JSON.stringify(analysis.debate.bear)}</p>
                                        </div>
                                    )}
                                </Section>
                            )}

                            <div className="mt-8 p-4 bg-soma-accent/5 border border-soma-accent/20 rounded flex items-start gap-3">
                                <Terminal className="w-5 h-5 text-soma-accent mt-0.5" />
                                <div>
                                    <h4 className="text-xs font-bold text-soma-accent mb-1">EXECUTION WARNING</h4>
                                    <p className="text-[10px] text-slate-400">
                                        This analysis was generated by SOMA's AI swarm. Confirm Strategy Preset selection and adjust position size in Risk Panel before engaging Autonomous Mode.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

// Helper components for structured rendering
const Section = ({ icon, title, color, children }) => (
    <div className="p-4 bg-soma-900/30 border border-soma-800/50 rounded-lg">
        <div className={`flex items-center gap-2 ${color} mb-3`}>
            {icon}
            <span className="text-xs font-bold tracking-widest">{title}</span>
        </div>
        {children}
    </div>
);

const Stat = ({ label, value, highlight }) => (
    <div className="bg-soma-900/50 p-2 rounded border border-soma-800/30">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
        <div className={`text-sm font-bold ${highlight ? 'text-soma-accent' : 'text-white'} mt-0.5`}>
            {value || 'N/A'}
        </div>
    </div>
);
