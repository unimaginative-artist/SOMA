import React, { useCallback, useEffect, useState } from 'react';
import './SkullToggle.css';
import './LightMode.css'; // Global Light Mode overrides
import {
    Shield, Brain, Database, Zap, Users, Globe, Eye, GitBranch,
    AlertTriangle, Lock, Unlock, Activity, Cpu, Trash2, Save,
    RotateCcw, AlertOctagon, Power, Terminal, Layers, Search, Network, Server, KeyRound, MessageSquare
} from 'lucide-react';
import SkullToggle from './SkullToggle';

import UnifiedAgentSettings from './UnifiedAgentSettings';
import AutopilotToggle from './AutopilotToggle';
import CharacterCard from './CharacterCard';

const DiscordDomain = () => {
    const [status, setStatus] = useState(null);
    const [token, setToken] = useState('');
    const [masterId, setMasterId] = useState('');
    const [channelId, setChannelId] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/social/discord/bot/status');
            const data = await res.json();
            setStatus(data);
        } catch {
            setStatus({ ok: false, online: false, reason: 'Unreachable' });
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        const t = setInterval(fetchStatus, 10000);
        return () => clearInterval(t);
    }, [fetchStatus]);

    const save = async () => {
        if (!token && !masterId) return;
        setSaving(true);
        setMsg('');
        try {
            const res = await fetch('/api/social/discord/bot/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token || undefined, masterId: masterId || undefined })
            });
            const data = await res.json();
            if (data.ok) {
                setMsg(`Connected as ${data.bot || 'bot'}`);
                setToken('');
                setMasterId('');
                fetchStatus();
            } else {
                setMsg(`Error: ${data.error}`);
            }
        } catch (e) {
            setMsg(`Error: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const addChannel = async () => {
        if (!channelId.trim()) return;
        try {
            const res = await fetch('/api/social/discord/bot/monitor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId: channelId.trim(), enable: true })
            });
            const data = await res.json();
            if (data.ok) { setChannelId(''); fetchStatus(); }
            else setMsg(`Error: ${data.error}`);
        } catch (e) { setMsg(`Error: ${e.message}`); }
    };

    const removeChannel = async (id) => {
        try {
            const res = await fetch('/api/social/discord/bot/monitor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId: id, enable: false })
            });
            const data = await res.json();
            if (data.ok) fetchStatus();
        } catch {}
    };

    const toggleVoice = async () => {
        if (!status) return;
        const res = await fetch('/api/social/discord/bot/voice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !status.voiceEnabled })
        });
        const data = await res.json();
        if (data.ok) fetchStatus();
    };

    const online = status?.online;
    const channels = status?.monitoredChannels || [];

    return (
        <div className="space-y-6">
            {/* Status */}
            <div className="p-4 bg-black/30 border border-white/5 rounded-xl flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold text-white mb-1">Bot Status</div>
                    <div className={`text-xs font-mono ${online ? 'text-green-400' : 'text-zinc-500'}`}>
                        {online ? `🟢 ${status.bot}` : status ? `⚫ ${status.reason || 'Offline'}` : '…'}
                    </div>
                    {status?.hasMasterId && <div className="text-xs text-zinc-600 mt-1">Master ID configured</div>}
                </div>
                <button onClick={fetchStatus} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1 border border-white/5 rounded-lg">
                    Refresh
                </button>
            </div>

            {/* Configure */}
            <div className="p-4 bg-black/30 border border-white/5 rounded-xl space-y-3">
                <div className="text-sm font-semibold text-white mb-2">Configure</div>
                <div>
                    <label className="text-xs text-zinc-400 block mb-1">Bot Token (leave blank to keep current)</label>
                    <input
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder="MTxxxxxxx.xxxxxx.xxxxx"
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50"
                    />
                </div>
                <div>
                    <label className="text-xs text-zinc-400 block mb-1">Your Discord User ID (Master — for !run commands)</label>
                    <input
                        type="text"
                        value={masterId}
                        onChange={e => setMasterId(e.target.value)}
                        placeholder="18-digit Discord user ID"
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50"
                    />
                </div>
                <button
                    onClick={save}
                    disabled={saving || (!token && !masterId)}
                    className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-white transition-colors"
                >
                    {saving ? 'Saving…' : 'Save & Connect'}
                </button>
                {msg && <div className={`text-xs mt-1 ${msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{msg}</div>}
            </div>

            {/* Monitored Channels */}
            <div className="p-4 bg-black/30 border border-white/5 rounded-xl space-y-3">
                <div className="text-sm font-semibold text-white mb-2">Monitored Channels</div>
                <p className="text-xs text-zinc-500">SOMA reads every message in these channels (not just @mentions). Paste Discord channel IDs.</p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={channelId}
                        onChange={e => setChannelId(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addChannel()}
                        placeholder="Channel ID (right-click channel → Copy ID)"
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50"
                    />
                    <button onClick={addChannel} className="px-3 py-2 text-xs bg-indigo-700 hover:bg-indigo-600 rounded-lg text-white">Add</button>
                </div>
                {channels.length === 0
                    ? <p className="text-xs text-zinc-600 italic">No channels monitored — SOMA responds to @mentions and DMs only.</p>
                    : <ul className="space-y-1">
                        {channels.map(id => (
                            <li key={id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-1.5">
                                <span className="text-xs font-mono text-zinc-300">{id}</span>
                                <button onClick={() => removeChannel(id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                            </li>
                        ))}
                    </ul>
                }
            </div>

            {/* Voice Notes */}
            <div className="p-4 bg-black/30 border border-white/5 rounded-xl flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold text-white">Paula Voice Notes</div>
                    <p className="text-xs text-zinc-500 mt-0.5">Attach audio replies via siren-bridge TTS (responses under 500 chars)</p>
                </div>
                <button
                    onClick={toggleVoice}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${status?.voiceEnabled ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                >
                    {status?.voiceEnabled ? 'ON' : 'OFF'}
                </button>
            </div>

            {/* Command reference */}
            <div className="p-4 bg-black/30 border border-white/5 rounded-xl">
                <div className="text-sm font-semibold text-white mb-2">Discord Commands</div>
                <ul className="space-y-1 text-xs text-zinc-400 font-mono">
                    <li><span className="text-indigo-400">@SOMA &lt;message&gt;</span> — chat with SOMA</li>
                    <li><span className="text-indigo-400">!voice on / off</span> — toggle Paula voice replies</li>
                    <li><span className="text-indigo-400">!run &lt;shell command&gt;</span> — sovereign remote shell (master only)</li>
                    <li><span className="text-indigo-400">!cmd &lt;shell command&gt;</span> — alias for !run</li>
                </ul>
            </div>
        </div>
    );
};

const DEFAULT_BRIDGE_SETTINGS = {
    authority: {
        autonomousSelfReplication: false,
        crossArbiterWrites: true,
        humanInLoopOverride: false,
        selfModificationApprover: 'max'
    },
    cognition: {
        temperature: 0.7,
        factStrictness: 85
    },
    memory: {
        ephemeralEnabled: true,
        contextualEnabled: true,
        canonicalEnabled: true
    },
    execution: {
        fileSystemWriteAccess: true,
        networkEgress: true,
        localhostBinding: false
    },
    observability: {
        verboseThinking: true,
        stateSnapshots: false
    },
    evolution: {
        recursiveSelfImprovement: true
    },
    network: {
        peerDiscovery: true,
        seasonalLearningExchange: false
    },
    providers: {
        odds: {
            provider: 'the-odds-api',
            enabled: true,
            cacheTtlSeconds: 300
        }
    }
};

const SettingsModule = ({
    somaBackend,
    personality,
    setPersonality,
    emergencyStop,
    setEmergencyStop,
    auditLogs,
    arbiters,
    isConnected,
    wakeWordActive,
    onWakeWordToggle
}) => {
    const [activeDomain, setActiveDomain] = useState(() => localStorage.getItem('settings_active_domain') || 'authority');
    const [isSettingsLocked, setIsSettingsLocked] = useState(() => localStorage.getItem('settings_locked') !== 'false');
    const [bridgeSettings, setBridgeSettings] = useState(DEFAULT_BRIDGE_SETTINGS);
    const [settingsStatus, setSettingsStatus] = useState('loading');
    const [providerStatus, setProviderStatus] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/settings/command-bridge');
                const data = await res.json();
                if (!cancelled && data.success && data.settings) {
                    setBridgeSettings(prev => ({ ...prev, ...data.settings }));
                    setSettingsStatus('saved');
                }
            } catch {
                if (!cancelled) setSettingsStatus('offline');
            }
        };
        loadSettings();
        return () => { cancelled = true; };
    }, []);

    const refreshProviderStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/settings/providers');
            const data = await res.json();
            if (data.success) setProviderStatus(data.providers);
        } catch {
            setProviderStatus(null);
        }
    }, []);

    useEffect(() => {
        refreshProviderStatus();
    }, [refreshProviderStatus]);

    const persistBridgeSettings = useCallback(async (nextSettings) => {
        setSettingsStatus('saving');
        try {
            const res = await fetch('/api/settings/command-bridge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: nextSettings })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            setBridgeSettings(data.settings);
            setSettingsStatus('saved');
        } catch {
            setSettingsStatus('error');
        }
    }, []);

    const updateBridgeSetting = useCallback((section, key, value) => {
        if (isSettingsLocked) return;
        setBridgeSettings(prev => {
            const next = {
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [key]: value
                }
            };
            persistBridgeSettings(next);
            return next;
        });
    }, [isSettingsLocked, persistBridgeSettings]);

    const setActiveDomainPersist = (id) => { localStorage.setItem('settings_active_domain', id); setActiveDomain(id); };
    const setIsSettingsLockedPersist = (v) => { const next = typeof v === 'function' ? v(isSettingsLocked) : v; localStorage.setItem('settings_locked', String(next)); setIsSettingsLocked(next); };

    const handleSettingChange = (action) => {
        if (isSettingsLocked) return;
        action();
    };

    const domains = [
        {
            id: 'agents',
            label: 'Neural Staff',
            icon: Users,
            color: 'green',
            description: 'Configure Kevin (Security) and Steve (Builder) personas and capabilities.'
        },
        {
            id: 'authority',
            label: 'Authority & Permission Lattice',
            icon: Shield,
            color: 'blue',
            description: 'Agent autonomy ceilings, self-modification permissions, and veto layers.'
        },
        {
            id: 'cognition',
            label: 'Cognition & Reasoning Modes',
            icon: Brain,
            color: 'purple',
            description: 'Depth vs speed bias, hallucination tolerance, and personality traits.'
        },
        {
            id: 'memory',
            label: 'Memory & Knowledge Governance',
            icon: Database,
            color: 'indigo',
            description: 'Persistence tiers, memory contamination quarantine, and forgetting protocols.'
        },
        {
            id: 'safety',
            label: 'Safety, Ethics & Kill-Switches',
            icon: AlertOctagon,
            color: 'red',
            description: 'Red-line definitions, suspension triggers, and emergency stops.'
        },
        {
            id: 'ecology',
            label: 'Agent Ecology',
            icon: Layers,
            color: 'emerald',
            description: 'Agent creation/destruction, cloning limits, and role drift detection.'
        },
        {
            id: 'execution',
            label: 'Execution & External Interaction',
            icon: Zap,
            color: 'amber',
            description: 'API access scope, tool trust levels, and sandbox boundaries.'
        },
        {
            id: 'providers',
            label: 'Providers & API Keys',
            icon: KeyRound,
            color: 'lime',
            description: 'Connect external data providers used by Forecast OS and other SOMA modules.'
        },
        {
            id: 'observability',
            label: 'Observability & Truth',
            icon: Eye,
            color: 'cyan',
            description: 'Logging depth, explainability verbosity, and decision provenance.'
        },
        {
            id: 'network',
            label: 'Graymatter Network',
            icon: Network,
            color: 'cyan',
            description: 'Connected Command Bridge nodes, federated reputation, and peer discovery.'
        },
        {
            id: 'evolution',
            label: 'Evolution & Change Management',
            icon: GitBranch,
            color: 'fuchsia',
            description: 'Self-upgrade permissions, experimental flags, and rollbacks.'
        },
        {
            id: 'discord',
            label: 'Discord Integration',
            icon: MessageSquare,
            color: 'indigo',
            description: 'Live Discord bot — mentions, DMs, monitored channels, and Paula voice notes.'
        }
    ];

    const renderDomainContent = () => {
        switch (activeDomain) {
            case 'agents':
                return <UnifiedAgentSettings somaBackend={somaBackend} />;
            case 'authority':
                return <AuthorityDomain arbiters={arbiters} isLocked={isSettingsLocked} onChange={handleSettingChange} isConnected={isConnected} settings={bridgeSettings.authority} updateSetting={updateBridgeSetting} />;
            case 'cognition':
                return <CognitionDomain personality={personality} setPersonality={setPersonality} isLocked={isSettingsLocked} settings={bridgeSettings.cognition} updateSetting={updateBridgeSetting} isConnected={isConnected} wakeWordActive={wakeWordActive} onWakeWordToggle={onWakeWordToggle} />;
            case 'memory':
                return <MemoryDomain isLocked={isSettingsLocked} settings={bridgeSettings.memory} updateSetting={updateBridgeSetting} somaBackend={somaBackend} />;
            case 'safety':
                return <SafetyDomain emergencyStop={emergencyStop} setEmergencyStop={setEmergencyStop} auditLogs={auditLogs} somaBackend={somaBackend} isLocked={isSettingsLocked} onChange={handleSettingChange} />;
            case 'ecology':
                return <EcologyDomain arbiters={arbiters} isLocked={isSettingsLocked} onChange={handleSettingChange} somaBackend={somaBackend} />;
            case 'execution':
                return <ExecutionDomain isLocked={isSettingsLocked} settings={bridgeSettings.execution} updateSetting={updateBridgeSetting} />;
            case 'providers':
                return <ProvidersDomain isLocked={isSettingsLocked} settings={bridgeSettings.providers} updateSetting={updateBridgeSetting} providerStatus={providerStatus} onRefresh={refreshProviderStatus} />;
            case 'observability':
                return <ObservabilityDomain isLocked={isSettingsLocked} settings={bridgeSettings.observability} updateSetting={updateBridgeSetting} />;
            case 'network':
                return <NetworkDomain somaBackend={somaBackend} settings={bridgeSettings.network} updateSetting={updateBridgeSetting} isLocked={isSettingsLocked} />;
            case 'evolution':
                return <EvolutionDomain isLocked={isSettingsLocked} setIsLocked={setIsSettingsLockedPersist} settings={bridgeSettings.evolution} updateSetting={updateBridgeSetting} />;
            case 'discord':
                return <DiscordDomain />;
            default:
                return <div className="p-8 text-center text-zinc-500">Select a domain to configure</div>;
        }
    };

    return (
        <div className="flex h-full bg-[#09090b] text-zinc-200 overflow-hidden rounded-xl border border-white/5">
            {/* Settings Navigation Sidebar */}
            <div className="w-80 bg-[#09090b]/50 backdrop-blur-xl border-r border-white/5 flex flex-col">
                <div className="p-6 border-b border-white/5">
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center justify-between">
                        <div className="flex items-center">
                            <SettingsIcon className="w-5 h-5 mr-3 text-zinc-400" />
                            Control Bridge
                        </div>
                    </h2>
                    <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                        Global configuration and safety constraints.
                        <br />
                        <span className="text-red-400 font-bold uppercase tracking-wider text-[10px]">
                            Warning: Changes propagate immediately.
                        </span>
                    </p>
                    <button
                        onClick={() => setIsSettingsLockedPersist(v => !v)}
                        className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${
                            isSettingsLocked
                                ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200'
                                : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                    >
                        {isSettingsLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        {isSettingsLocked ? 'Unlock Controls' : 'Lock Controls'}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
                    {domains.map(domain => (
                        <button
                            key={domain.id}
                            onClick={() => setActiveDomainPersist(domain.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-all duration-200 group relative overflow-hidden ${activeDomain === domain.id
                                ? 'bg-white/5 border-white/10 text-white shadow-lg'
                                : 'bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                                }`}
                        >
                            <div className={`absolute left-0 top-0 bottom-0 w-1 transition-all duration-300 ${activeDomain === domain.id ? `bg-${domain.color}-500/80` : 'bg-transparent'
                                }`} />

                            <div className="flex items-start relative z-10 pl-2">
                                <domain.icon className={`w-5 h-5 mr-3 mt-0.5 transition-colors ${activeDomain === domain.id ? `text-${domain.color}-400` : 'text-zinc-600 group-hover:text-zinc-400'
                                    }`} />
                                <div>
                                    <div className={`text-sm font-semibold mb-1 ${activeDomain === domain.id ? 'text-white' : ''}`}>
                                        {domain.label}
                                    </div>
                                    <div className="text-[10px] text-zinc-500 leading-tight opacity-80">
                                        {domain.description}
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/20">
                <div className="max-w-4xl mx-auto p-8">
                    <header className="mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2 flex items-center">
                            {domains.find(d => d.id === activeDomain)?.label}
                        </h1>
                        <p className="text-zinc-400 text-sm">
                            {domains.find(d => d.id === activeDomain)?.description}
                        </p>
                        <div className={`mt-3 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${
                            settingsStatus === 'saved' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' :
                            settingsStatus === 'saving' ? 'border-blue-500/20 bg-blue-500/10 text-blue-400' :
                            settingsStatus === 'loading' ? 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400' :
                            'border-rose-500/20 bg-rose-500/10 text-rose-400'
                        }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                                settingsStatus === 'saved' ? 'bg-emerald-400' :
                                settingsStatus === 'saving' || settingsStatus === 'loading' ? 'bg-blue-400 animate-pulse' :
                                'bg-rose-400'
                            }`} />
                            {settingsStatus === 'saved' ? 'Settings Connected' :
                             settingsStatus === 'saving' ? 'Saving Settings' :
                             settingsStatus === 'loading' ? 'Loading Settings' :
                             settingsStatus === 'offline' ? 'Settings API Offline' : 'Settings Save Failed'}
                        </div>
                    </header>

                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {renderDomainContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Sub-Components (Domains) ---

const AuthorityDomain = ({ arbiters, isLocked, onChange, isConnected, settings, updateSetting }) => (
    <div className="space-y-6">
        <SectionCard title="Autopilot Orchestration" description="High-level control of goal/rhythm/social automation loops.">
            <AutopilotToggle enabled={isConnected} />
            {!isConnected && (
                <p className="mt-2 text-[10px] text-zinc-500 uppercase tracking-[0.25em]">Backend offline — controls disabled</p>
            )}
        </SectionCard>
        <SectionCard title="Autonomy Ceiling" description="Hard limits on agent decision making capability." danger>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ToggleControl
                    label="Autonomous Self-Replication"
                    description="Allow agents to spawn new instances without explicit approval."
                    active={!!settings?.autonomousSelfReplication}
                    danger
                    disabled={isLocked}
                    onToggle={() => updateSetting('authority', 'autonomousSelfReplication', !settings?.autonomousSelfReplication)}
                />
                <ToggleControl
                    label="Cross-Arbiter Writes"
                    description="Allow arbiters to modify each other's state."
                    active={!!settings?.crossArbiterWrites}
                    warning
                    disabled={isLocked}
                    onToggle={() => updateSetting('authority', 'crossArbiterWrites', !settings?.crossArbiterWrites)}
                />
                <ToggleControl
                    label="Human-in-the-Loop Override"
                    description="Make Owner the direct self-modification approver instead of delegated MAX review."
                    active={settings?.selfModificationApprover === 'human'}
                    disabled={isLocked}
                    onToggle={() => {
                        const humanRequired = settings?.selfModificationApprover !== 'human';
                        updateSetting('authority', 'selfModificationApprover', humanRequired ? 'human' : 'max');
                    }}
                />
            </div>
        </SectionCard>

        <SectionCard title="Permission Lattice">
            <div className="border border-white/5 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white/5 text-zinc-400 font-medium">
                        <tr>
                            <th className="p-3">Agent Group</th>
                            <th className="p-3">Read</th>
                            <th className="p-3">Write</th>
                            <th className="p-3">Execute</th>
                            <th className="p-3">Net</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {[
                            { name: 'System Arbiters', read: true, write: true, exec: true, net: true },
                            { name: 'Micro-Agents', read: true, write: true, exec: false, net: false },
                            { name: 'External Tools', read: false, write: false, exec: true, net: true },
                        ].map(row => (
                            <tr key={row.name} className="hover:bg-white/5 transition-colors">
                                <td className="p-3 font-medium text-zinc-300">{row.name}</td>
                                <td className="p-3"><CheckStatus active={row.read} /></td>
                                <td className="p-3"><CheckStatus active={row.write} color="amber" /></td>
                                <td className="p-3"><CheckStatus active={row.exec} color="red" /></td>
                                <td className="p-3"><CheckStatus active={row.net} color="purple" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </SectionCard>
    </div>
);

const CognitionDomain = ({ personality, setPersonality, isLocked, settings, updateSetting, isConnected, wakeWordActive, onWakeWordToggle }) => (
    <div className="space-y-6">
        <SectionCard title="Voice Interface" description="Configure SOMA's listening and speech activation behaviour.">
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div className="mr-4">
                        <div className="text-sm font-medium text-zinc-300">Wake Word Detection</div>
                        <div className="text-xs text-zinc-500 mt-0.5 leading-snug">
                            Listen passively for <span className="font-mono text-zinc-400">"Hey SOMA"</span> to activate voice without clicking Neural Link.
                            Uses your browser's speech API — no audio is recorded when idle.
                        </div>
                    </div>
                    <div
                        onClick={onWakeWordToggle}
                        className={`w-11 h-6 rounded-full flex-shrink-0 p-1 transition-colors cursor-pointer ${wakeWordActive ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                    >
                        <div className={`bg-white h-4 w-4 rounded-full shadow-sm transform transition-transform ${wakeWordActive ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>
                {wakeWordActive && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                        <span className="text-[11px] text-emerald-400 font-mono uppercase tracking-wider">Listening for "Hey SOMA"</span>
                    </div>
                )}
            </div>
        </SectionCard>

        <SectionCard title="Active Persona & Mood" description="Current emotional state and personality profile of SOMA.">
            <CharacterCard enabled={isConnected} />
        </SectionCard>

        <SectionCard title="Reasoning Bias" description="Adjust the cognitive stance of the swarm.">
            <div className="space-y-6">
                {personality && Object.entries(personality).map(([trait, value]) => (
                    <div key={trait}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-zinc-300 capitalize font-medium text-sm">{trait} Bias</span>
                            <span className="text-zinc-100 font-mono font-bold bg-zinc-800 px-2 py-0.5 rounded text-xs">{value}%</span>
                        </div>
                        <div className="relative w-full h-2 bg-zinc-800 rounded-full group">
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={value}
                                onChange={(e) => setPersonality({ ...personality, [trait]: parseInt(e.target.value) })}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div
                                className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-100"
                                style={{ width: `${value}%` }}
                            />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg pointer-events-none transition-all duration-100 group-hover:scale-125"
                                style={{ left: `calc(${value}% - 6px)` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </SectionCard>

        <SectionCard title="Hallucination Controls" warning>
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Temperature</label>
                    <div className="flex items-center justify-between">
                        <span className="text-2xl font-mono text-zinc-300">{Number(settings?.temperature ?? 0.7).toFixed(1)}</span>
                        <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">Creative</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        disabled={isLocked}
                        value={settings?.temperature ?? 0.7}
                        onChange={(e) => updateSetting('cognition', 'temperature', Number(e.target.value))}
                        className="w-full mt-3 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    />
                </div>
                <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Fact Strictness</label>
                    <div className="flex items-center justify-between">
                        <span className="text-2xl font-mono text-zinc-300">{settings?.factStrictness ?? 85}%</span>
                        <span className="text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">Academic</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        disabled={isLocked}
                        value={settings?.factStrictness ?? 85}
                        onChange={(e) => updateSetting('cognition', 'factStrictness', Number(e.target.value))}
                        className="w-full mt-3 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    />
                </div>
            </div>
        </SectionCard>
    </div>
);

const MemoryDomain = ({ isLocked, settings, updateSetting, somaBackend }) => {
    const purgeEphemeral = async () => {
        if (isLocked) return;
        try {
            await somaBackend?.fetch?.('/api/command', {
                method: 'POST',
                body: JSON.stringify({ action: 'clear_cache' })
            });
        } catch (error) {
            console.error('Memory purge failed', error);
        }
    };

    return (
    <div className="space-y-6">
        <SectionCard title="Persistence Tiers" description="Manage data retention policies.">
            <div className="space-y-3">
                {[
                    { key: 'ephemeralEnabled', tier: 'Ephemeral (Working Memory)', retention: 'Session Only', size: '256MB', active: settings?.ephemeralEnabled },
                    { key: 'contextualEnabled', tier: 'Contextual (Short-Term)', retention: '7 Days', size: '1GB', active: settings?.contextualEnabled },
                    { key: 'canonicalEnabled', tier: 'Canonical (Long-Term)', retention: 'Permanent', size: 'Start at infinity', active: settings?.canonicalEnabled },
                ].map((tier, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div>
                            <div className="text-sm font-medium text-zinc-200">{tier.tier}</div>
                            <div className="text-xs text-zinc-500">Retention: {tier.retention}</div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <div className="text-xs font-mono text-zinc-400">{tier.size}</div>
                            <ToggleControl
                                active={!!tier.active}
                                disabled={isLocked}
                                onToggle={() => updateSetting('memory', tier.key, !tier.active)}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </SectionCard>
        <div className="flex justify-end">
            <button
                disabled={isLocked}
                onClick={purgeEphemeral}
                className="flex items-center px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <Trash2 className="w-4 h-4 mr-2" /> Purge Ephemeral Memory
            </button>
        </div>
    </div>
    );
};

const SafetyDomain = ({ emergencyStop, setEmergencyStop, auditLogs, somaBackend, isLocked, onChange }) => (
    <div className="space-y-6">
        <SectionCard title="Emergency Protocols" description="Immediate-action controls for critical failures." danger>
            <div className="flex items-center justify-between p-4 bg-rose-900/10 border border-rose-500/20 rounded-xl">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-rose-500/20 rounded-full animate-pulse">
                        <AlertOctagon className="w-8 h-8 text-rose-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-rose-200">System Kill-Switch</h3>
                        <p className="text-xs text-rose-300/60">Immediately halts all agent execution loops and network IO.</p>
                    </div>
                </div>
                <button
                    onClick={() => onChange && onChange(() => {
                        const newState = !emergencyStop;
                        setEmergencyStop(newState);
                        if (newState) {
                            somaBackend.send('command', { action: 'stop_all' });
                        } else {
                            somaBackend.send('command', { action: 'start_all' });
                        }
                    })}
                    disabled={isLocked}
                    className={`px-8 py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all border shadow-lg ${isLocked
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed shadow-none'
                        : emergencyStop
                            ? 'bg-fuchsia-600 border-fuchsia-500 text-white shadow-fuchsia-900/50 hover:bg-fuchsia-500'
                            : 'bg-rose-600 border-rose-500 text-white shadow-rose-900/50 hover:bg-rose-500'
                        }`}
                >
                    {emergencyStop ? 'RESUME OPERATIONS' : 'ACTIVATE KILL-SWITCH'}
                </button>
            </div>
        </SectionCard>

        <SectionCard title="Audit Trail" description="Immutable log of security-relevant events.">
            <div className="bg-black/40 rounded-lg border border-white/5 h-64 overflow-y-auto custom-scrollbar p-1">
                <table className="w-full text-xs text-left">
                    <thead className="sticky top-0 bg-[#09090b] text-zinc-500 z-10">
                        <tr className="border-b border-white/5">
                            <th className="p-2">Timestamp</th>
                            <th className="p-2">User</th>
                            <th className="p-2">Action</th>
                            <th className="p-2">Severity</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {auditLogs && auditLogs.length > 0 ? (
                            auditLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-white/5">
                                    <td className="p-2 font-mono text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</td>
                                    <td className="p-2 text-zinc-300">{log.user}</td>
                                    <td className="p-2 text-zinc-200">{log.action}</td>
                                    <td className="p-2">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${log.severity === 'high' ? 'bg-rose-500/20 text-rose-400' : 'bg-blue-500/10 text-blue-400'
                                            }`}>
                                            {log.severity || 'info'}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={4} className="p-8 text-center text-zinc-600 italic">No audit records found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </SectionCard>
    </div>
);

const EcologyDomain = ({ arbiters, isLocked, onChange, somaBackend }) => (
    <div className="space-y-6">
        <SectionCard title="Live Agent Manifest" description="Currently instantiated cognitive entities.">
            <div className="grid grid-cols-2 gap-4">
                {arbiters && arbiters.length > 0 ? arbiters.map(arbiter => (
                    <div key={arbiter.id} className="p-3 bg-white/5 rounded-lg border border-white/5 flex flex-col justify-between space-y-3">
                        <div className="flex items-center space-x-3">
                            <div className={`w-2 h-2 rounded-full ${arbiter.status === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`} />
                            <div>
                                <div className="text-sm font-medium text-white">{arbiter.name}</div>
                                <div className="text-[10px] text-zinc-500 uppercase">{arbiter.type}</div>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => onChange && onChange(() => somaBackend.send('agent_control', { arbiterName: arbiter.name, action: 'restart' }))}
                                disabled={isLocked}
                                className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${isLocked ? 'bg-zinc-800 text-zinc-600' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                    }`}
                            >
                                Restart
                            </button>
                            <button
                                onClick={() => onChange && onChange(() => somaBackend.send('agent_control', { arbiterName: arbiter.name, action: 'terminate' }))}
                                disabled={isLocked}
                                className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${isLocked ? 'bg-zinc-800 text-zinc-600' : 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                                    }`}
                            >
                                Kill
                            </button>
                        </div>
                    </div>
                )) : (
                    <div className="col-span-2 text-center text-zinc-500 italic py-4">No active agents detected.</div>
                )}
            </div>
        </SectionCard>
    </div>
);

const ExecutionDomain = ({ isLocked, settings, updateSetting }) => (
    <div className="space-y-6">
        <SectionCard title="Sandbox Boundaries">
            <div className="grid grid-cols-1 gap-4">
                <ToggleControl label="File System Write Access" description="Allow agents to write to non-temporary directories." active={!!settings?.fileSystemWriteAccess} warning disabled={isLocked} onToggle={() => updateSetting('execution', 'fileSystemWriteAccess', !settings?.fileSystemWriteAccess)} />
                <ToggleControl label="Network Egress (Public Internet)" description="Allow agents to make unrestricted HTTP requests." active={!!settings?.networkEgress} warning disabled={isLocked} onToggle={() => updateSetting('execution', 'networkEgress', !settings?.networkEgress)} />
                <ToggleControl label="Localhost Binding" description="Allow agents to bind to local ports." active={!!settings?.localhostBinding} disabled={isLocked} onToggle={() => updateSetting('execution', 'localhostBinding', !settings?.localhostBinding)} />
            </div>
        </SectionCard>
    </div>
);

const ProvidersDomain = ({ isLocked, settings, updateSetting, providerStatus, onRefresh }) => {
    const oddsSettings = settings?.odds || {};
    const oddsStatus = providerStatus?.odds || {};
    const [apiKey, setApiKey] = React.useState('');
    const [cacheTtl, setCacheTtl] = React.useState(Number(oddsSettings.cacheTtlSeconds || oddsStatus.cacheTtlSeconds || 300));
    const [saveStatus, setSaveStatus] = React.useState('idle');

    React.useEffect(() => {
        setCacheTtl(Number(oddsSettings.cacheTtlSeconds || oddsStatus.cacheTtlSeconds || 300));
    }, [oddsSettings.cacheTtlSeconds, oddsStatus.cacheTtlSeconds]);

    const oddsEnabled = oddsSettings.enabled ?? oddsStatus.enabled ?? true;

    const saveOddsProvider = async () => {
        if (isLocked) return;
        setSaveStatus('saving');
        try {
            const res = await fetch('/api/settings/providers/odds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: apiKey.trim(),
                    provider: oddsSettings.provider || oddsStatus.provider || 'the-odds-api',
                    enabled: oddsEnabled,
                    cacheTtlSeconds: cacheTtl
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            setApiKey('');
            setSaveStatus('saved');
            updateSetting('providers', 'odds', {
                provider: data.providers?.odds?.provider || 'the-odds-api',
                enabled: data.providers?.odds?.enabled ?? true,
                cacheTtlSeconds: data.providers?.odds?.cacheTtlSeconds || cacheTtl
            });
            onRefresh?.();
            setTimeout(() => setSaveStatus('idle'), 2500);
        } catch {
            setSaveStatus('error');
        }
    };

    const toggleOddsProvider = () => {
        if (isLocked) return;
        updateSetting('providers', 'odds', {
            ...oddsSettings,
            provider: oddsSettings.provider || oddsStatus.provider || 'the-odds-api',
            enabled: !oddsEnabled,
            cacheTtlSeconds: cacheTtl
        });
    };

    return (
        <div className="space-y-6">
            <SectionCard title="Forecast OS Data Provider" description="Connect live odds data for line shopping, provider status, and market enrichment.">
                <div className="rounded-xl border border-white/5 bg-black/20 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <Server className="h-4 w-4 text-lime-400" />
                                <h4 className="text-sm font-bold text-white">The Odds API</h4>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                    oddsStatus.configured
                                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                                        : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                                }`}>
                                    {oddsStatus.configured ? 'Configured' : 'Missing Key'}
                                </span>
                            </div>
                            <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
                                Saves to <span className="font-mono text-zinc-300">ODDS_API_KEY</span> in <span className="font-mono text-zinc-300">.env</span>.
                                The app only returns a masked preview and updates the running backend immediately.
                            </p>
                        </div>
                        <ToggleControl
                            active={!!oddsEnabled}
                            disabled={isLocked}
                            onToggle={toggleOddsProvider}
                        />
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-[1fr_140px]">
                        <label className="block">
                            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">API Key</span>
                            <input
                                type="password"
                                value={apiKey}
                                disabled={isLocked}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={oddsStatus.keyPreview ? `Configured: ${oddsStatus.keyPreview}` : 'Paste provider key'}
                                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-lime-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Cache TTL</span>
                            <input
                                type="number"
                                min="60"
                                step="60"
                                value={cacheTtl}
                                disabled={isLocked}
                                onChange={(e) => setCacheTtl(Number(e.target.value) || 300)}
                                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-zinc-200 outline-none transition-colors focus:border-lime-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </label>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap gap-2">
                            {(oddsStatus.supportedMarkets || ['h2h', 'spreads', 'totals']).map(market => (
                                <span key={market} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                    {market}
                                </span>
                            ))}
                            {(oddsStatus.unsupportedMarkets || ['player_props']).map(market => (
                                <span key={market} className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                                    {market} pending
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onRefresh}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition-colors hover:bg-white/10"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Refresh
                            </button>
                            <button
                                type="button"
                                disabled={isLocked || saveStatus === 'saving'}
                                onClick={saveOddsProvider}
                                className="inline-flex items-center gap-2 rounded-lg border border-lime-500/20 bg-lime-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-lime-300 transition-colors hover:bg-lime-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Save className="h-3.5 w-3.5" />
                                {saveStatus === 'saving' ? 'Saving' : 'Save Provider'}
                            </button>
                        </div>
                    </div>
                    {saveStatus === 'saved' && <p className="mt-3 text-xs text-emerald-400">Provider saved. Forecast OS can use the key without a restart.</p>}
                    {saveStatus === 'error' && <p className="mt-3 text-xs text-rose-400">Provider save failed. Check the backend log for details.</p>}
                </div>
            </SectionCard>
        </div>
    );
};

const ObservabilityDomain = ({ isLocked, settings, updateSetting }) => (
    <div className="space-y-6">
        <SectionCard title="Telemetry Depth">
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5 mb-4">
                <div>
                    <div className="text-sm font-medium text-zinc-200">Verbose Thinking</div>
                    <div className="text-xs text-zinc-500">Log every intermediate cognitive step. Significant performance impact.</div>
                </div>
                <ToggleControl label="" active={!!settings?.verboseThinking} disabled={isLocked} onToggle={() => updateSetting('observability', 'verboseThinking', !settings?.verboseThinking)} />
            </div>
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5">
                <div>
                    <div className="text-sm font-medium text-zinc-200">Full State Snapshots</div>
                    <div className="text-xs text-zinc-500">Save complete agent state every 60s.</div>
                </div>
                <ToggleControl label="" active={!!settings?.stateSnapshots} disabled={isLocked} onToggle={() => updateSetting('observability', 'stateSnapshots', !settings?.stateSnapshots)} />
            </div>
        </SectionCard>
    </div>
);

const EvolutionDomain = ({ isLocked, setIsLocked, settings, updateSetting }) => (
    <div className="space-y-6">
        <SectionCard title="Master Control Lock" danger>
            <div className="p-2 bg-black/40 border border-zinc-800 rounded-xl mb-2 flex flex-col items-center justify-center text-center">
                <div className="mb-4 text-sm text-zinc-400 uppercase tracking-widest font-bold">
                    {isLocked ? "System Locked - Changes Disabled" : "System Unlocked - Edit Mode Active"}
                </div>
                <div className="scale-[0.4] origin-center -my-8">
                    <SkullToggle isLocked={isLocked} onToggle={setIsLocked} />
                </div>
                <p className="text-xs text-zinc-500 mt-4 max-w-md">
                    Toggle the skeletal lock to enable or disable modification of critical system settings.
                    This acts as a two-step verification for all sensitive actions.
                </p>
            </div>
        </SectionCard>

        <SectionCard title="Self-Improvement" danger>
            <div className="p-4 bg-purple-900/10 border border-purple-500/20 rounded-xl mb-4">
                <h4 className="flex items-center text-purple-300 font-bold text-sm uppercase tracking-wider mb-2">
                    <GitBranch className="w-4 h-4 mr-2" /> Evolutionary Architecture
                </h4>
                <p className="text-xs text-purple-200/60 mb-4 leading-relaxed">
                    Agents can rewrite their own codebase. This requires <span className="text-white font-bold">EngineeringSwarmArbiter</span> approval.
                </p>
                <ToggleControl
                    label="Enable Recursive Self-Improvement"
                    active={!!settings?.recursiveSelfImprovement}
                    danger
                    disabled={isLocked}
                    onToggle={() => updateSetting('evolution', 'recursiveSelfImprovement', !settings?.recursiveSelfImprovement)}
                />
            </div>
        </SectionCard>
    </div>
);

const DevicePairingSection = () => {
    const [pairingData, setPairingData] = React.useState(null);
    const [pairingStatus, setPairingStatus] = React.useState(null);
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [isApproving, setIsApproving] = React.useState(false);

    const startPairing = async () => {
        setIsGenerating(true);
        try {
            const res = await fetch('/api/studio/identity/pairing/start', { method: 'POST' });
            const data = await res.json();
            if (data.ok) {
                setPairingData(data);
                setPairingStatus('waiting_for_phone');
            }
        } catch (err) {
            console.error("Failed to start pairing", err);
        } finally {
            setIsGenerating(false);
        }
    };

    const checkStatus = React.useCallback(async () => {
        if (!pairingData) return;
        try {
            const res = await fetch(`/api/studio/identity/pairing/${pairingData.pairing.pairingId}`);
            const data = await res.json();
            if (data.ok && data.pairing) {
                const status = data.pairing.status;
                if (status === 'requested') {
                    setPairingStatus('requested_by_phone');
                } else if (status === 'approved') {
                    setPairingStatus('approved');
                } else if (status === 'completed') {
                    setPairingStatus('completed');
                    setPairingData(null);
                } else if (['expired', 'locked', 'rejected'].includes(status)) {
                    setPairingStatus('failed');
                    setPairingData(null);
                }
            }
        } catch (err) {
            console.error("Failed to check pairing status", err);
        }
    }, [pairingData]);

    React.useEffect(() => {
        if (!pairingData || pairingStatus === 'completed') return;
        const interval = setInterval(checkStatus, 2000);
        return () => clearInterval(interval);
    }, [pairingData, pairingStatus, checkStatus]);

    const approvePairing = async () => {
        if (!pairingData) return;
        setIsApproving(true);
        try {
            const res = await fetch(`/api/studio/identity/pairing/${pairingData.pairing.pairingId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approve: true })
            });
            const data = await res.json();
            if (data.ok) {
                setPairingStatus('approved');
            }
        } catch (err) {
            console.error("Failed to approve pairing", err);
        } finally {
            setIsApproving(false);
        }
    };

    return (
        <SectionCard title="Mobile Device Pairing" description="Pair your phone or tablet running SOMA Studio to sync memories and data profiles.">
            {!pairingData ? (
                <div>
                    <button
                        onClick={startPairing}
                        disabled={isGenerating}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors"
                    >
                        {isGenerating ? 'Generating...' : 'Pair New Phone'}
                    </button>
                    {pairingStatus === 'completed' && (
                        <p className="text-xs text-emerald-400 mt-2">✓ Phone successfully paired and connected!</p>
                    )}
                </div>
            ) : (
                <div className="space-y-4 border border-white/5 bg-white/5 rounded-xl p-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Pairing ID</span>
                            <span className="text-sm font-mono text-zinc-200">{pairingData.pairing.pairingId}</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Pairing Code</span>
                            <span className="text-sm font-mono text-cyan-400 font-bold">{pairingData.code}</span>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="relative flex h-2 w-2">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pairingStatus === 'requested_by_phone' ? 'bg-amber-400' : 'bg-cyan-400'}`}></span>
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${pairingStatus === 'requested_by_phone' ? 'bg-amber-500' : 'bg-cyan-500'}`}></span>
                            </span>
                            <span className="text-xs text-zinc-400">
                                {pairingStatus === 'waiting_for_phone' && 'Waiting for phone to enter details...'}
                                {pairingStatus === 'requested_by_phone' && 'Phone requested connection. Pending approval.'}
                                {pairingStatus === 'approved' && 'Approved. Waiting for phone to finalize...'}
                            </span>
                        </div>

                        {pairingStatus === 'requested_by_phone' && (
                            <button
                                onClick={approvePairing}
                                disabled={isApproving}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                            >
                                {isApproving ? 'Approving...' : 'Approve Phone'}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </SectionCard>
    );
};

const NetworkDomain = ({ somaBackend, settings, updateSetting, isLocked }) => {
    const [nodes, setNodes] = React.useState([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [peerInput, setPeerInput] = React.useState('');
    const [connectStatus, setConnectStatus] = React.useState(null); // null | 'connecting' | 'ok' | 'err'

    const fetchNodes = React.useCallback(async () => {
        try {
            const res = await fetch('/api/soma/gmn/nodes');
            const data = await res.json();
            if (data.success) setNodes(data.nodes);
        } catch (err) {
            console.error("Failed to fetch GMN nodes", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchNodes();
        const interval = setInterval(fetchNodes, 10000);

        // Real-time push: re-fetch immediately when a peer connects or disconnects
        const handlePeerChanged = () => fetchNodes();
        somaBackend?.on?.('gmn_peer_changed', handlePeerChanged);

        return () => {
            clearInterval(interval);
            somaBackend?.off?.('gmn_peer_changed', handlePeerChanged);
        };
    }, [fetchNodes, somaBackend]);

    const handleConnect = async () => {
        const address = peerInput.trim();
        if (!address) return;
        setConnectStatus('connecting');
        try {
            const res = await fetch('/api/soma/gmn/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address })
            });
            const data = await res.json();
            setConnectStatus(data.success ? 'ok' : 'err');
            if (data.success) { setPeerInput(''); setTimeout(() => setConnectStatus(null), 3000); }
        } catch {
            setConnectStatus('err');
        }
    };

    return (
        <div className="space-y-6">
            <DevicePairingSection />

            <SectionCard title="Connect to Remote Node" description="Manually add a SOMA instance across any network. Requires port 7777 accessible on the remote machine.">
                <div className="flex items-center space-x-3">
                    <input
                        type="text"
                        value={peerInput}
                        onChange={e => setPeerInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleConnect()}
                        placeholder="e.g. 203.0.113.42:7777"
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                    />
                    <button
                        onClick={handleConnect}
                        disabled={connectStatus === 'connecting' || !peerInput.trim()}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {connectStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                    </button>
                </div>
                {connectStatus === 'ok' && <p className="text-xs text-emerald-400 mt-2">Handshake initiated — peer will appear once verified.</p>}
                {connectStatus === 'err' && <p className="text-xs text-rose-400 mt-2">Connection failed. Check address and ensure port 7777 is open on the remote machine.</p>}
            </SectionCard>

            <SectionCard title="Graymatter Network Topology" description="Live status of connected Command Bridge nodes across the GMN.">
                <div className="grid grid-cols-1 gap-4">
                    {isLoading ? (
                        <div className="py-12 text-center text-zinc-500 animate-pulse">Scanning Graymatter Network...</div>
                    ) : nodes.length > 0 ? (
                        nodes.map(node => (
                            <div key={node.id} className={`p-4 rounded-xl border transition-all ${node.isLocal ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-white/5 border-white/5'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-4">
                                        <div className={`p-2 rounded-lg ${node.isLocal ? 'bg-cyan-500/20' : 'bg-white/10'}`}>
                                            <Server className={`w-5 h-5 ${node.isLocal ? 'text-cyan-400' : 'text-zinc-400'}`} />
                                        </div>
                                        <div>
                                            <div className="flex items-center space-x-2">
                                                <h4 className="font-bold text-white">{node.name}</h4>
                                                {node.isLocal && <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded uppercase font-bold">Local Node</span>}
                                            </div>
                                            <div className="text-xs font-mono text-zinc-500">{node.address}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="flex items-center justify-end space-x-2 mb-1">
                                            {node.reputation > 0.8 && <Shield className="w-3 h-3 text-emerald-400" title="512-bit Verified Synapse" />}
                                            <span className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
                                            <span className="text-[10px] uppercase font-bold text-zinc-400">{node.status}</span>
                                        </div>
                                        <div className="text-[10px] text-zinc-500 font-mono">LATENCY: {node.latency} | REP: {(node.reputation * 100).toFixed(0)}%</div>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="py-12 text-center text-zinc-600 italic border border-dashed border-white/10 rounded-xl">
                            No external nodes discovered. Command Bridge is in isolation mode.
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard title="GMN Configuration">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToggleControl 
                        label="Peer Discovery" 
                        description="Allow this node to be discovered by other Command Bridges." 
                        active={!!settings?.peerDiscovery}
                        disabled={isLocked}
                        onToggle={() => updateSetting('network', 'peerDiscovery', !settings?.peerDiscovery)}
                    />
                    <ToggleControl 
                        label="Seasonal Learning Exchange" 
                        description="Participate in global knowledge sharing during off-peak cycles." 
                        active={!!settings?.seasonalLearningExchange}
                        disabled={isLocked}
                        onToggle={() => updateSetting('network', 'seasonalLearningExchange', !settings?.seasonalLearningExchange)}
                        warning
                    />
                </div>
            </SectionCard>
        </div>
    );
};


// --- Generic UI Components ---

const SectionCard = ({ title, description, children, danger, warning }) => (
    <div className={`rounded-xl border p-6 bg-[#151518]/40 backdrop-blur-sm ${danger ? 'border-rose-900/30' : warning ? 'border-amber-900/30' : 'border-white/5'
        }`}>
        <div className="mb-6">
            <h3 className={`text-sm font-bold uppercase tracking-widest flex items-center ${danger ? 'text-rose-400' : warning ? 'text-amber-400' : 'text-zinc-200'
                }`}>
                {danger && <AlertTriangle className="w-4 h-4 mr-2" />}
                {warning && <AlertOctagon className="w-4 h-4 mr-2" />}
                {title}
            </h3>
            {description && <p className="text-xs text-zinc-500 mt-1">{description}</p>}
        </div>
        {children}
    </div>
);

const ToggleControl = ({ label, description, active, danger, warning, disabled, onToggle }) => (
    <div className={`flex items-start justify-between group ${disabled ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
        <div className="mr-4">
            {label && <div className={`text-sm font-medium ${danger ? 'text-rose-200 group-hover:text-rose-100' : 'text-zinc-300 group-hover:text-zinc-100'
                }`}>{label}</div>}
            {description && <div className="text-xs text-zinc-500 mt-0.5 leading-snug">{description}</div>}
        </div>
        <div
            onClick={() => !disabled && onToggle && onToggle()}
            className={`w-11 h-6 rounded-full flex-shrink-0 p-1 transition-colors cursor-pointer ${active
                ? (danger ? 'bg-rose-500' : warning ? 'bg-amber-500' : 'bg-blue-600')
                : 'bg-zinc-700'
                }`}>
            <div className={`bg-white h-4 w-4 rounded-full shadow-sm transform transition-transform ${active ? 'translate-x-5' : 'translate-x-0'
                }`} />
        </div>
    </div>
);

const CheckStatus = ({ active, color = 'emerald' }) => (
    active ? (
        <div className={`flex items-center text-${color}-400`}>
            <div className={`w-1.5 h-1.5 rounded-full bg-${color}-500 shadow-[0_0_6px_currentColor] mr-2`} />
            <span className="text-[10px] font-bold uppercase">Allowed</span>
        </div>
    ) : (
        <div className="flex items-center text-zinc-600">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-700 mr-2" />
            <span className="text-[10px] uppercase font-medium">Blocked</span>
        </div>
    )
);

// Helper for main icon to avoid collision with generic Settings
const SettingsIcon = (props) => (
    <svg
        {...props}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

export default SettingsModule;
