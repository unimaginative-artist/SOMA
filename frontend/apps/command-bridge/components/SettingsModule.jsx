import React, { useState } from 'react';
import './SkullToggle.css';
import './LightMode.css'; // Global Light Mode overrides
import {
    Shield, Brain, Database, Zap, Users, Globe, Eye, GitBranch,
    AlertTriangle, Lock, Unlock, Activity, Cpu, Trash2, Save,
    RotateCcw, AlertOctagon, Power, Terminal, Layers, Search, Network
} from 'lucide-react';
import SkullToggle from './SkullToggle';

import UnifiedAgentSettings from './UnifiedAgentSettings';
import AutopilotToggle from './AutopilotToggle';
import CharacterCard from './CharacterCard';

const SettingsModule = ({
    somaBackend,
    personality,
    setPersonality,
    emergencyStop,
    setEmergencyStop,
    auditLogs,
    arbiters,
    isConnected
}) => {
    const [activeDomain, setActiveDomain] = useState('authority');
    const [isSettingsLocked, setIsSettingsLocked] = useState(true);

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
        }
    ];

    const renderDomainContent = () => {
        switch (activeDomain) {
            case 'agents':
                return <UnifiedAgentSettings somaBackend={somaBackend} />;
            case 'authority':
                return <AuthorityDomain arbiters={arbiters} isLocked={isSettingsLocked} onChange={handleSettingChange} isConnected={isConnected} />;
            case 'cognition':
                return <CognitionDomain personality={personality} setPersonality={setPersonality} isLocked={isSettingsLocked} onChange={handleSettingChange} isConnected={isConnected} />;
            case 'memory':
                return <MemoryDomain isLocked={isSettingsLocked} onChange={handleSettingChange} />;
            case 'safety':
                return <SafetyDomain emergencyStop={emergencyStop} setEmergencyStop={setEmergencyStop} auditLogs={auditLogs} somaBackend={somaBackend} isLocked={isSettingsLocked} onChange={handleSettingChange} />;
            case 'ecology':
                return <EcologyDomain arbiters={arbiters} isLocked={isSettingsLocked} onChange={handleSettingChange} somaBackend={somaBackend} />;
            case 'execution':
                return <ExecutionDomain isLocked={isSettingsLocked} onChange={handleSettingChange} />;
            case 'observability':
                return <ObservabilityDomain isLocked={isSettingsLocked} onChange={handleSettingChange} />;
            case 'network':
                return <NetworkDomain somaBackend={somaBackend} />;
            case 'evolution':
                return <EvolutionDomain isLocked={isSettingsLocked} setIsLocked={setIsSettingsLocked} />;
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
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
                    {domains.map(domain => (
                        <button
                            key={domain.id}
                            onClick={() => setActiveDomain(domain.id)}
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

const AuthorityDomain = ({ arbiters, isLocked, onChange, isConnected }) => (
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
                    active={false}
                    danger
                    disabled={isLocked}
                    onToggle={() => onChange && onChange(() => console.log("Toggle Replication"))}
                />
                <ToggleControl
                    label="Cross-Arbiter Writes"
                    description="Allow arbiters to modify each other's state."
                    active={true}
                    warning
                    disabled={isLocked}
                    onToggle={() => onChange && onChange(() => console.log("Toggle Writes"))}
                />
                <ToggleControl
                    label="Human-in-the-Loop Override"
                    description="Require human approval for high-stakes actions."
                    active={true}
                    disabled={isLocked}
                    onToggle={() => onChange && onChange(() => console.log("Toggle Override"))}
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

const CognitionDomain = ({ personality, setPersonality, isConnected }) => (
    <div className="space-y-6">
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
                        <span className="text-2xl font-mono text-zinc-300">0.7</span>
                        <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">Creative</span>
                    </div>
                    <input type="range" className="w-full mt-3 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Fact Strictness</label>
                    <div className="flex items-center justify-between">
                        <span className="text-2xl font-mono text-zinc-300">High</span>
                        <span className="text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">Academic</span>
                    </div>
                    <input type="range" className="w-full mt-3 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                </div>
            </div>
        </SectionCard>
    </div>
);

const MemoryDomain = () => (
    <div className="space-y-6">
        <SectionCard title="Persistence Tiers" description="Manage data retention policies.">
            <div className="space-y-3">
                {[
                    { tier: 'Ephemeral (Working Memory)', retention: 'Session Only', size: '256MB', active: true },
                    { tier: 'Contextual (Short-Term)', retention: '7 Days', size: '1GB', active: true },
                    { tier: 'Canonical (Long-Term)', retention: 'Permanent', size: 'Start at infinity', active: true },
                ].map((tier, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div>
                            <div className="text-sm font-medium text-zinc-200">{tier.tier}</div>
                            <div className="text-xs text-zinc-500">Retention: {tier.retention}</div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <div className="text-xs font-mono text-zinc-400">{tier.size}</div>
                            <CheckStatus active={tier.active} />
                        </div>
                    </div>
                ))}
            </div>
        </SectionCard>
        <div className="flex justify-end">
            <button className="flex items-center px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all">
                <Trash2 className="w-4 h-4 mr-2" /> Purge Ephemeral Memory
            </button>
        </div>
    </div>
);

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

const ExecutionDomain = ({ isLocked, onChange }) => (
    <div className="space-y-6">
        <SectionCard title="Sandbox Boundaries">
            <div className="grid grid-cols-1 gap-4">
                <ToggleControl label="File System Write Access" description="Allow agents to write to non-temporary directories." active={true} warning disabled={isLocked} onToggle={() => onChange && onChange(() => console.log("FS Write"))} />
                <ToggleControl label="Network Egress (Public Internet)" description="Allow agents to make unrestricted HTTP requests." active={true} warning disabled={isLocked} onToggle={() => onChange && onChange(() => console.log("Net Egress"))} />
                <ToggleControl label="Localhost Binding" description="Allow agents to bind to local ports." active={false} disabled={isLocked} onToggle={() => onChange && onChange(() => console.log("Localhost"))} />
            </div>
        </SectionCard>
    </div>
);

const ObservabilityDomain = ({ isLocked, onChange }) => (
    <div className="space-y-6">
        <SectionCard title="Telemetry Depth">
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5 mb-4">
                <div>
                    <div className="text-sm font-medium text-zinc-200">Verbose Thinking</div>
                    <div className="text-xs text-zinc-500">Log every intermediate cognitive step. Significant performance impact.</div>
                </div>
                <ToggleControl label="" active={true} disabled={isLocked} onToggle={() => onChange && onChange(() => console.log("Verbose"))} />
            </div>
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5">
                <div>
                    <div className="text-sm font-medium text-zinc-200">Full State Snapshots</div>
                    <div className="text-xs text-zinc-500">Save complete agent state every 60s.</div>
                </div>
                <ToggleControl label="" active={false} disabled={isLocked} onToggle={() => onChange && onChange(() => console.log("Snapshots"))} />
            </div>
        </SectionCard>
    </div>
);

const EvolutionDomain = ({ isLocked, setIsLocked }) => (
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
                    active={true}
                    danger
                    disabled={isLocked}
                    onToggle={() => console.log("Self improvement toggle")}
                />
            </div>
        </SectionCard>
    </div>
);

const NetworkDomain = ({ somaBackend }) => {
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
                        active={true}
                    />
                    <ToggleControl 
                        label="Seasonal Learning Exchange" 
                        description="Participate in global knowledge sharing during off-peak cycles." 
                        active={false}
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
