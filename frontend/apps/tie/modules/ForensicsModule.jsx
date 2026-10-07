import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import { Shield, AlertTriangle, CheckCircle, FileText, BarChart3, Grid3X3, Search, Activity, Cpu } from 'lucide-react';

const T = {
    bg:      '#09090b',
    surface: '#111113',
    card:    '#18181b',
    border:  'rgba(255,255,255,0.07)',
    border2: 'rgba(255,255,255,0.12)',
    text:    '#fafafa',
    dim:     '#a1a1aa',
    dimmer:  '#52525b',
    blue:    '#00aaff',
    success: '#33ffaa',
    warning: '#ffaa33',
    danger:  '#ff4455',
};

// ── Components ──────────────────────────────────────────────────────────────

const BenfordChart = ({ data, expected }) => {
    const chartData = Object.keys(expected).map(digit => ({
        name: digit,
        Actual: data[digit] * 100,
        Expected: expected[digit] * 100,
    }));

    return (
        <div style={{ height: 200, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#52525b" fontSize={10} unit="%" tickLine={false} axisLine={false} />
                    <Tooltip 
                        contentStyle={{ background: '#18181b', border: '1px solid #27272a', fontSize: 11 }}
                        itemStyle={{ fontSize: 11 }}
                    />
                    <Bar dataKey="Actual" fill="#00aaff" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Expected" fill="rgba(255,255,255,0.1)" radius={[2, 2, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

const RiskPie = ({ stats }) => {
    const data = Object.entries(stats).map(([name, s]) => ({
        name,
        value: s.overrides + s.errors
    })).filter(d => d.value > 0);

    if (data.length === 0) return <div style={{ fontSize: 10, color: T.dimmer, textAlign: 'center', padding: 20 }}>NO RISKS DETECTED</div>;

    const COLORS = [T.danger, T.warning, T.blue, T.success, '#7755ff'];

    return (
        <div style={{ height: 160, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={data}
                        innerRadius={40}
                        outerRadius={60}
                        paddingAngle={5}
                        dataKey="value"
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', fontSize: 10 }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

// ── Main Module ─────────────────────────────────────────────────────────────

export default function ForensicsModule({ identity }) {
    const [pdfPath, setPdfPath] = useState('');
    const [excelPath, setExcelPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);
    const [view, setView] = useState('dashboard'); // 'dashboard' or 'report'

    // Project Integration
    const [projects, setProjects] = useState([]);
    const [selectedProject, setSelectedProject] = useState(null);
    const [projectFiles, setProjectFiles] = useState([]);
    const [showFilePicker, setShowFilePicker] = useState(null); // 'excel' or 'pdf'

    useEffect(() => {
        fetch('/api/workspace/projects')
            .then(r => r.json())
            .then(d => setProjects(d.projects || []))
            .catch(() => {});
    }, []);

    const loadProjectFiles = async (projectId) => {
        const res = await fetch(`/api/workspace/projects/${projectId}/files`);
        const data = await res.json();
        setProjectFiles(data.files || []);
    };

    const selectProject = (id) => {
        const p = projects.find(p => p.id === id);
        setSelectedProject(p);
        if (p) loadProjectFiles(p.id);
    };

    const downloadReport = () => {
        if (!results) return;
        const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SOMA_Forensic_Report_${results.target}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const runAudit = async () => {
        if (!excelPath) return setError("Excel path is required");
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/soma/forensics/suite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdfPath, excelPath })
            });
            const data = await res.json();
            if (data.success) {
                setResults(data);
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: 24, height: '100%', overflow: 'auto', background: T.bg, color: T.text, fontFamily: "'JetBrains Mono', monospace" }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ 
                            width: 48, height: 48, borderRadius: 12, background: 'rgba(0,170,255,0.1)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.blueGlow || T.border2}`
                        }}>
                            <Shield size={24} color={T.blue} />
                        </div>
                        <div>
                            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>SOVEREIGN FORENSIC SUITE</div>
                            <div style={{ fontSize: 10, color: T.dimmer, letterSpacing: 3, marginTop: 4 }}>PROVENANCE INVESTIGATION ENGINE V1.0</div>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Cpu size={14} color={T.dimmer} />
                            <span style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>ENGINE: <span style={{ color: T.blue }}>QUAD-BRAIN FORENSIC</span></span>
                        </div>
                        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Activity size={14} color={T.success} />
                            <span style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>STATUS: <span style={{ color: T.success }}>OPERATIONAL</span></span>
                        </div>
                    </div>
                </div>

                {/* Project & File Selection */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>
                    <div style={{ background: T.card, padding: 16, borderRadius: 12, border: `1px solid ${T.border}` }}>
                        <div style={{ fontSize: 9, color: T.dimmer, marginBottom: 8, letterSpacing: 1 }}>SELECT SOMA PROJECT</div>
                        <select 
                            onChange={e => selectProject(e.target.value)}
                            style={{ width: '100%', background: T.surface, color: T.text, border: `1px solid ${T.border}`, padding: 8, borderRadius: 6, fontSize: 11 }}
                        >
                            <option value="">-- No Project --</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    {selectedProject && (
                        <div style={{ background: T.card, padding: 16, borderRadius: 12, border: `1px solid ${T.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 9, color: T.dimmer, marginBottom: 8, letterSpacing: 1 }}>PROJECT FILES</div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button 
                                        onClick={() => setShowFilePicker('excel')}
                                        style={{ flex: 1, padding: 8, background: T.surface, border: `1px solid ${excelPath ? T.blue : T.border}`, borderRadius: 6, color: T.dim, fontSize: 10, cursor: 'pointer' }}
                                    >
                                        {excelPath ? 'EXCEL SELECTED' : 'PICK EXCEL'}
                                    </button>
                                    <button 
                                        onClick={() => setShowFilePicker('pdf')}
                                        style={{ flex: 1, padding: 8, background: T.surface, border: `1px solid ${pdfPath ? T.blue : T.border}`, borderRadius: 6, color: T.dim, fontSize: 10, cursor: 'pointer' }}
                                    >
                                        {pdfPath ? 'PDF SELECTED' : 'PICK PDF'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* File Picker Modal */}
                <AnimatePresence>
                    {showFilePicker && (
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => setShowFilePicker(null)}
                        >
                            <motion.div 
                                initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                                style={{ width: 400, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24 }}
                                onClick={e => e.stopPropagation()}
                            >
                                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 16 }}>PICK {showFilePicker.toUpperCase()} FILE</div>
                                <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {projectFiles.filter(f => showFilePicker === 'excel' ? f.originalName.endsWith('.xlsx') || f.originalName.endsWith('.csv') : f.originalName.endsWith('.pdf')).map(f => (
                                        <button 
                                            key={f.id}
                                            onClick={() => {
                                                if (showFilePicker === 'excel') setExcelPath(f.path);
                                                else setPdfPath(f.path);
                                                setShowFilePicker(null);
                                            }}
                                            style={{ padding: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 11, textAlign: 'left', cursor: 'pointer' }}
                                        >
                                            {f.originalName}
                                        </button>
                                    ))}
                                    {projectFiles.length === 0 && <div style={{ fontSize: 10, color: T.dimmer, textAlign: 'center' }}>NO FILES IN PROJECT</div>}
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Manual Path Overrides */}
                <div style={{ 
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16,
                    background: T.card, padding: 24, borderRadius: 16, border: `1px solid ${T.border}`,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)', marginBottom: 32
                }}>
                    <div style={{ position: 'relative' }}>
                        <div style={{ fontSize: 9, color: T.dimmer, marginBottom: 8, letterSpacing: 1, fontWeight: 700 }}>EXCEL PATH (GL / TRIAL BALANCE)</div>
                        <input 
                            value={excelPath}
                            onChange={e => setExcelPath(e.target.value)}
                            placeholder="C:\Audit\2026\General_Ledger.xlsx"
                            style={{ 
                                width: '100%', background: T.surface, border: `1px solid ${T.border}`,
                                borderRadius: 8, color: T.text, padding: '12px 16px', fontSize: 12,
                                outline: 'none', transition: 'border-color 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = T.blue}
                            onBlur={e => e.target.style.borderColor = T.border}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 9, color: T.dimmer, marginBottom: 8, letterSpacing: 1, fontWeight: 700 }}>PDF PATH (BANK STATEMENT)</div>
                        <input 
                            value={pdfPath}
                            onChange={e => setPdfPath(e.target.value)}
                            placeholder="C:\Audit\2026\Bank_Statement_Jan.pdf"
                            style={{ 
                                width: '100%', background: T.surface, border: `1px solid ${T.border}`,
                                borderRadius: 8, color: T.text, padding: '12px 16px', fontSize: 12,
                                outline: 'none'
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button 
                            onClick={runAudit}
                            disabled={loading || !excelPath}
                            style={{ 
                                height: 46, padding: '0 32px', background: T.blue, color: '#050506',
                                border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 800,
                                cursor: (loading || !excelPath) ? 'default' : 'pointer',
                                opacity: (loading || !excelPath) ? 0.5 : 1,
                                letterSpacing: 2, transition: 'transform 0.1s'
                            }}
                            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
                            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            {loading ? 'ANALYZING...' : 'EXECUTE AUDIT'}
                        </button>
                    </div>
                </div>

                {error && (
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        style={{ 
                            padding: 20, background: 'rgba(255,68,85,0.05)', borderLeft: `4px solid ${T.danger}`,
                            borderRadius: 8, color: T.danger, fontSize: 12, marginBottom: 32,
                            display: 'flex', alignItems: 'center', gap: 12
                        }}
                    >
                        <AlertTriangle size={18} />
                        <div>{error}</div>
                    </motion.div>
                )}

                {/* Dashboard */}
                {results && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {/* Summary View */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 2, marginBottom: 8 }}>OVERALL VERDICT</div>
                                <div style={{ 
                                    fontSize: 16, fontWeight: 800, 
                                    color: results.overall_verdict.includes('CLEAN') ? T.success : (results.overall_verdict.includes('MINOR') ? T.warning : T.danger)
                                }}>
                                    {results.overall_verdict}
                                </div>
                            </div>
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 2, marginBottom: 8 }}>STRUCTURAL RISK</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: results.heatmap.overall_risk_score > 0.05 ? T.danger : T.text }}>
                                    {(results.heatmap.overall_risk_score * 100).toFixed(2)}% <span style={{ fontSize: 10, color: T.dimmer, fontWeight: 400 }}>DENSITY</span>
                                </div>
                            </div>
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 2, marginBottom: 8 }}>BENFORD CONFORMITY</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: results.benford.verdict === 'NATURAL' ? T.success : T.danger }}>
                                    {results.benford.analyses ? Object.values(results.benford.analyses)[0].conformity.toUpperCase() : 'N/A'}
                                </div>
                            </div>
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 2, marginBottom: 8 }}>TIE HANDSHAKE</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: results.tie?.verdict === 'AUDIT READY' ? T.success : T.dimmer }}>
                                    {results.tie ? results.tie.verdict : 'SKIPPED'}
                                </div>
                            </div>
                        </div>

                        {/* Analysis Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
                            {/* Benford Column */}
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 28 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <BarChart3 size={20} color={T.blue} />
                                        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>STATISTICAL ANOMALY DETECTION</span>
                                    </div>
                                    <div style={{ fontSize: 10, color: T.dimmer }}>MAD ANALYSIS</div>
                                </div>

                                {results.benford.analyses && Object.entries(results.benford.analyses).map(([col, analysis], idx) => (
                                    <div key={idx} style={{ marginBottom: 32 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
                                            <div>
                                                <div style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>COLUMN</div>
                                                <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{col}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>FIDELITY</div>
                                                <div style={{ fontSize: 13, color: T.blue, fontWeight: 700 }}>{(analysis.fidelity_score * 100).toFixed(1)}%</div>
                                            </div>
                                        </div>
                                        <BenfordChart data={analysis.distribution} expected={analysis.expected} />
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 20 }}>
                                            <div style={{ background: T.surface, padding: 12, borderRadius: 8 }}>
                                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1 }}>SAMPLE SIZE</div>
                                                <div style={{ fontSize: 12, color: T.text, marginTop: 4 }}>{analysis.sample_size}</div>
                                            </div>
                                            <div style={{ background: T.surface, padding: 12, borderRadius: 8 }}>
                                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1 }}>MAD SCORE</div>
                                                <div style={{ fontSize: 12, color: T.text, marginTop: 4 }}>{analysis.mad.toFixed(4)}</div>
                                            </div>
                                            <div style={{ background: T.surface, padding: 12, borderRadius: 8 }}>
                                                <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1 }}>P-VALUE</div>
                                                <div style={{ fontSize: 12, color: T.text, marginTop: 4 }}>{analysis.p_value.toFixed(4)}</div>
                                            </div>
                                        </div>
                                    </div>
                                )).slice(0, 1)}
                            </div>

                            {/* Risk Stack */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                {/* Heatmap / Risk Density */}
                                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 28 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <Grid3X3 size={20} color={T.warning} />
                                            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>STRUCTURAL RISK DENSITY</span>
                                        </div>
                                    </div>
                                    <RiskPie stats={results.heatmap.sheet_stats} />
                                    <div style={{ marginTop: 20 }}>
                                        {Object.entries(results.heatmap.sheet_stats).map(([name, s], idx) => (
                                            <div key={idx} style={{ 
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                                                padding: '10px 0', borderBottom: `1px solid ${T.border}`
                                            }}>
                                                <div style={{ fontSize: 11, color: T.text }}>{name}</div>
                                                <div style={{ display: 'flex', gap: 12 }}>
                                                    <div style={{ fontSize: 10, color: s.overrides > 0 ? T.danger : T.dimmer }}>{s.overrides} OVERRIDES</div>
                                                    <div style={{ fontSize: 10, color: s.errors > 0 ? T.warning : T.dimmer }}>{s.errors} ERRORS</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Detailed Findings Trigger */}
                                <div style={{ 
                                    background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 24,
                                    display: 'flex', flexDirection: 'column', gap: 16
                                }}>
                                    <div style={{ fontSize: 11, color: T.dim, fontWeight: 600 }}>DETAILED ANOMALY LOG ({results.heatmap.findings.length})</div>
                                    <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {results.heatmap.findings.length === 0 ? (
                                            <div style={{ fontSize: 10, color: T.dimmer, textAlign: 'center', padding: 20 }}>NO INDIVIDUAL ANOMALIES LOGGED</div>
                                        ) : (
                                            results.heatmap.findings.map((f, i) => (
                                                <div key={i} style={{ 
                                                    padding: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
                                                    display: 'flex', gap: 12
                                                }}>
                                                    <div style={{ marginTop: 2 }}>{f.severity === 'CRITICAL' ? <AlertTriangle size={14} color={T.danger} /> : <AlertTriangle size={14} color={T.warning} />}</div>
                                                    <div>
                                                        <div style={{ fontSize: 10, fontWeight: 700, color: f.severity === 'CRITICAL' ? T.danger : T.warning }}>{f.type}</div>
                                                        <div style={{ fontSize: 9, color: T.dim, marginTop: 2 }}>{f.sheet} · {f.cell} · Value: {f.value}</div>
                                                        {f.context && <div style={{ fontSize: 8, color: T.dimmer, marginTop: 4, fontStyle: 'italic' }}>{f.context}</div>}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* Export / Report */}
                                <button 
                                    onClick={downloadReport}
                                    style={{ 
                                    width: '100%', padding: '16px', background: 'transparent', border: `1px solid ${T.border2}`,
                                    borderRadius: 12, color: T.dim, fontSize: 10, fontWeight: 700, letterSpacing: 2,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                                }}>
                                    <FileText size={14} />
                                    GENERATE FORENSIC JSON REPORT
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
