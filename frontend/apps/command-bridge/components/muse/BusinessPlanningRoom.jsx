import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import somaBackend from '../../somaBackend';
import { getSharedSessionId } from '../../utils/sharedSession';
import {
  EMPTY_BUSINESS_PROFILE, businessPlanFilename, missingRequiredFields, profileCompleteness,
} from './businessPlanService';
import BusinessWorkspacePanels from './BusinessWorkspacePanels';

const STORAGE_KEY = 'soma.businessPlanner.v1';

const readWorkspace = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { profile: { ...EMPTY_BUSINESS_PROFILE, ...(saved.profile || {}), financialAssumptions:{ ...EMPTY_BUSINESS_PROFILE.financialAssumptions, ...(saved.profile?.financialAssumptions || {}) } }, plan: String(saved.plan || ''), job: saved.job || null };
  } catch {
    return { profile: { ...EMPTY_BUSINESS_PROFILE }, plan: '', job: null };
  }
};

const isRunningJob = (job) => job && (job.status === 'queued' || job.status === 'running');
const isRunningRevision = (revision) => revision && (revision.status === 'queued' || revision.status === 'running');
const latestRevision = (job) => job?.collaboration?.revisions?.at?.(-1) || null;

function elapsedLabel(milliseconds = 0) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const markdownComponents = {
  h1: ({ children }) => <h1 style={{ fontSize:32, fontWeight:450, margin:'0 0 28px', paddingBottom:18, borderBottom:'1px solid oklch(0.28 0.012 60)', color:'oklch(0.94 0.012 80)', fontFamily:"'Fraunces',Georgia,serif" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize:20, fontWeight:450, margin:'30px 0 10px', color:'oklch(0.82 0.10 70)', fontFamily:"'Fraunces',Georgia,serif" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize:15, margin:'22px 0 8px', color:'oklch(0.94 0.012 80)' }}>{children}</h3>,
  p: ({ children }) => <p style={{ fontSize:13, lineHeight:1.75, margin:'8px 0', color:'oklch(0.72 0.012 70)' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft:22, fontSize:13, lineHeight:1.7, color:'oklch(0.72 0.012 70)' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft:22, fontSize:13, lineHeight:1.7, color:'oklch(0.72 0.012 70)' }}>{children}</ol>,
  strong: ({ children }) => <strong style={{ color:'oklch(0.94 0.012 80)' }}>{children}</strong>,
  table: ({ children }) => <div style={{ overflowX:'auto', margin:'16px 0', border:'1px solid oklch(0.28 0.012 60)', borderRadius:4 }}><table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>{children}</table></div>,
  th: ({ children }) => <th style={{ textAlign:'left', padding:'9px 10px', color:'oklch(0.94 0.012 80)', background:'oklch(0.20 0.015 60)', borderBottom:'1px solid oklch(0.28 0.012 60)' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding:'9px 10px', color:'oklch(0.68 0.012 70)', borderBottom:'1px solid oklch(0.24 0.012 60)' }}>{children}</td>,
};

function Field({ label, value, onChange, placeholder, multiline, required }) {
  const style = { width:'100%', boxSizing:'border-box', padding:'10px 12px', background:'oklch(0.11 0.010 50 / 0.72)', border:'1px solid oklch(0.28 0.012 60)', borderRadius:4, color:'oklch(0.94 0.012 80)', outline:'none', fontSize:12, lineHeight:1.5, resize:'vertical' };
  return (
    <label style={{ display:'block' }}>
      <span style={{ display:'block', marginBottom:6, color:'oklch(0.52 0.012 60)', fontSize:9, letterSpacing:'0.22em', textTransform:'uppercase', fontFamily:"'JetBrains Mono',monospace" }}>{label}{required ? ' · required' : ''}</span>
      {multiline
        ? <textarea rows={3} style={style} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input style={style} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </label>
  );
}

export default function BusinessPlanningRoom({ onExit, roomSwitcher, theme }) {
  const initial = useMemo(readWorkspace, []);
  const [profile, setProfile] = useState(initial.profile);
  const [plan, setPlan] = useState(initial.plan);
  const [job, setJob] = useState(initial.job);
  const [revision, setRevision] = useState(() => latestRevision(initial.job));
  const [revisionInput, setRevisionInput] = useState('');
  const [sendingRevision, setSendingRevision] = useState(false);
  const [previewPlan, setPreviewPlan] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState('plan');
  const [collaborationMode, setCollaborationMode] = useState('exploration');
  const [view, setView] = useState(isRunningJob(initial.job) ? 'progress' : initial.plan ? 'plan' : 'brief');
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState('');
  const [arbiteriumHandoff, setArbiteriumHandoff] = useState(() => initial.job?.arbiteriumHandoffs?.at?.(-1) || null);
  const [error, setError] = useState('');
  const completeness = profileCompleteness(profile);
  const thinking = starting || isRunningJob(job);
  const revisionNeedsDecision = revision?.status === 'proposed';

  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, plan, job, updatedAt:new Date().toISOString() })), 350);
    return () => clearTimeout(timer);
  }, [profile, plan, job]);

  useEffect(() => {
    if (!isRunningJob(job)) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const payload = await somaBackend.getBusinessPlanJob(job.id);
        if (stopped) return;
        const nextJob = payload.job;
        setJob(nextJob);
        if (nextJob.status === 'completed') {
          setPlan(nextJob.plan || '');
          setView('plan');
          return;
        }
        if (nextJob.status === 'failed' || nextJob.status === 'cancelled') {
          setError(nextJob.error || 'The business-plan council stopped before completing.');
          setView('progress');
          return;
        }
        timer = setTimeout(poll, 1600);
      } catch (cause) {
        if (!stopped) timer = setTimeout(poll, 3500);
      }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job?.id || !isRunningRevision(revision)) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const payload = await somaBackend.getBusinessPlanRevision(job.id, revision.id);
        if (stopped) return;
        if (payload.job) setJob(payload.job);
        if (payload.revision) setRevision(payload.revision);
        if (isRunningRevision(payload.revision)) timer = setTimeout(poll, 1600);
      } catch {
        if (!stopped) timer = setTimeout(poll, 3500);
      }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, revision?.id, revision?.status]);

  const update = (field) => (value) => setProfile((current) => ({ ...current, [field]:value }));
  const updateFinancial = (field) => (value) => setProfile((current) => ({ ...current, financialAssumptions:{ ...current.financialAssumptions, [field]:value } }));

  const generate = async () => {
    const missing = missingRequiredFields(profile);
    if (missing.length) { setError(`Begin with ${missing.join(', ')}.`); setView('brief'); return; }
    setStarting(true); setError('');
    try {
      const result = await somaBackend.createBusinessPlan(profile, { sessionId:getSharedSessionId() });
      if (!result?.job?.id) throw new Error('SOMA did not return a planning job.');
      setJob(result.job); setView('progress');
    } catch (cause) { setError(cause?.message || 'SOMA could not build the plan.'); }
    finally { setStarting(false); }
  };

  const cancel = async () => {
    if (!job?.id || !isRunningJob(job)) return;
    try {
      const result = await somaBackend.cancelBusinessPlanJob(job.id);
      if (result?.job) setJob(result.job);
    } catch (cause) { setError(cause?.message || 'The build could not be cancelled.'); }
  };

  const requestRevision = async (event) => {
    event?.preventDefault();
    const message = revisionInput.trim();
    if (!job?.id || !message || sendingRevision || isRunningRevision(revision) || revisionNeedsDecision) return;
    setSendingRevision(true); setError(''); setPreviewPlan('');
    try {
      const result = await somaBackend.createBusinessPlanRevision(job.id, message, collaborationMode);
      if (result.job) setJob(result.job);
      if (result.revision) setRevision(result.revision);
      setRevisionInput('');
    } catch (cause) { setError(cause?.message || 'SOMA could not begin that revision.'); }
    finally { setSendingRevision(false); }
  };

  const applyRevision = async () => {
    if (!job?.id || revision?.status !== 'proposed') return;
    try {
      const result = await somaBackend.applyBusinessPlanRevision(job.id, revision.id);
      if (result.job) { setJob(result.job); setPlan(result.job.plan || plan); }
      if (result.revision) setRevision(result.revision);
      setPreviewPlan('');
    } catch (cause) { setError(cause?.message || 'The revision could not be applied.'); }
  };

  const discardRevision = async () => {
    if (!job?.id || revision?.status !== 'proposed') return;
    try {
      const result = await somaBackend.discardBusinessPlanRevision(job.id, revision.id);
      if (result.job) setJob(result.job);
      if (result.revision) setRevision(result.revision);
      setPreviewPlan('');
    } catch (cause) { setError(cause?.message || 'The revision could not be discarded.'); }
  };

  const exportPlan = () => {
    const url = URL.createObjectURL(new Blob([plan], { type:'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = businessPlanFilename(profile.businessName); anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadModelExport = async (format) => {
    if (!job?.id || exporting) return;
    setExporting(format); setError('');
    try {
      const result = await somaBackend.downloadBusinessPlanExport(job.id, format);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename; anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause?.message || `The ${format.toUpperCase()} export could not be created.`); }
    finally { setExporting(''); }
  };

  const prepareArbiterium = async () => {
    if (!job?.id) return;
    setError('');
    try {
      const result = await somaBackend.prepareBusinessPlanArbiteriumHandoff(job.id);
      if (result.job) setJob(result.job);
      if (result.workflow) setArbiteriumHandoff(result.workflow);
    } catch (cause) { setError(cause?.message || 'The Arbiterium handoff could not be prepared.'); }
  };

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', background:`linear-gradient(145deg,${theme.voidDeep},oklch(0.14 0.025 55))`, color:theme.text }}>
      <div style={{ position:'absolute', width:'58%', aspectRatio:'1', right:'-18%', top:'-30%', borderRadius:'50%', background:`radial-gradient(circle,${theme.ember} 0%,transparent 65%)`, opacity:0.14, filter:'blur(48px)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:18, right:20, zIndex:5 }}>{roomSwitcher}</div>
      <div style={{ position:'absolute', top:18, left:20, zIndex:5, display:'flex', gap:12, alignItems:'center' }}>
        <button onClick={onExit} style={{ background:'transparent', border:'none', color:theme.textMute, cursor:'pointer', fontSize:10, letterSpacing:'0.22em', textTransform:'uppercase', fontFamily:"'JetBrains Mono',monospace" }}>← back · reflect</button>
        <span style={{ color:theme.hair }}>|</span>
        <button onClick={() => setView('brief')} style={{ background:'transparent', border:'none', color:view === 'brief' ? theme.ember : theme.textMute, cursor:'pointer', fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase' }}>brief</button>
        <button disabled={!job} onClick={() => setView('progress')} style={{ background:'transparent', border:'none', color:view === 'progress' ? theme.ember : theme.textMute, opacity:job?1:0.35, cursor:job?'pointer':'default', fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase' }}>council</button>
        <button disabled={!plan} onClick={() => setView('plan')} style={{ background:'transparent', border:'none', color:view === 'plan' ? theme.ember : theme.textMute, opacity:plan?1:0.35, cursor:plan?'pointer':'default', fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase' }}>plan</button>
      </div>

      <div style={{ position:'absolute', inset:'64px 0 0', overflowY:'auto', padding:'28px clamp(28px,6vw,90px) 60px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', position:'relative', zIndex:2 }}>
          <div style={{ marginBottom:24 }}>
            <div style={{ color:theme.ember, fontSize:10, letterSpacing:'0.3em', textTransform:'uppercase', marginBottom:8 }}>SOMA · Muse · Business Planning</div>
            <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:30, fontStyle:'italic', fontWeight:350 }}>{view === 'brief' ? 'make the idea operational.' : view === 'progress' ? 'the council is at work.' : (profile.businessName || 'the working plan.')}</div>
            <div style={{ marginTop:8, maxWidth:700, color:theme.textDim, fontSize:12, lineHeight:1.6 }}>{view === 'brief' ? 'Give SOMA what is true. Unknowns become research questions, not invented certainty.' : view === 'progress' ? 'Specialists work in parallel, then CRONA synthesizes, an adversary challenges, and an investment-grade quality gate revises the result.' : 'A decision draft. Challenge the assumptions before you trust the numbers.'}</div>
          </div>

          {error && <div style={{ marginBottom:18, padding:'10px 12px', color:'oklch(0.80 0.12 25)', border:'1px solid oklch(0.50 0.12 25)', background:'oklch(0.20 0.05 25 / 0.45)', borderRadius:4, fontSize:12 }}>{error}</div>}

          {view === 'brief' ? <>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <span style={{ fontSize:9, color:theme.textMute, letterSpacing:'0.2em', textTransform:'uppercase' }}>brief readiness</span>
              <div style={{ width:180, height:2, background:theme.hair }}><div style={{ width:`${completeness}%`, height:'100%', background:theme.ember, transition:'width .2s' }} /></div>
              <span style={{ color:theme.ember, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }}>{completeness}%</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:16, padding:22, border:`1px solid ${theme.hair}`, background:'oklch(0.14 0.012 55 / 0.78)', borderRadius:6 }}>
              <Field label="Business name" value={profile.businessName} onChange={update('businessName')} placeholder="a working name is enough" />
              <label><span style={{ display:'block', marginBottom:6, color:theme.textMute, fontSize:9, letterSpacing:'0.22em', textTransform:'uppercase' }}>Current stage</span><select value={profile.stage} onChange={(e) => update('stage')(e.target.value)} style={{ width:'100%', padding:'10px 12px', background:'oklch(0.11 0.010 50)', border:`1px solid ${theme.hair}`, borderRadius:4, color:theme.text, fontSize:12 }}><option value="idea">Idea</option><option value="validation">Customer validation</option><option value="mvp">MVP</option><option value="revenue">Early revenue</option><option value="growth">Growth</option></select></label>
              <Field required multiline label="Business concept" value={profile.concept} onChange={update('concept')} placeholder="what are you building?" />
              <Field required multiline label="Ideal customer" value={profile.customer} onChange={update('customer')} placeholder="who feels this most acutely?" />
              <Field required multiline label="Customer problem" value={profile.problem} onChange={update('problem')} placeholder="what is painful or expensive today?" />
              <Field multiline label="Product or service" value={profile.solution} onChange={update('solution')} placeholder="how will you solve it?" />
              <Field label="Revenue model" value={profile.revenueModel} onChange={update('revenueModel')} placeholder="subscription, fees, marketplace…" />
              <Field label="Geography" value={profile.geography} onChange={update('geography')} placeholder="local, US, global…" />
              <Field multiline label="Founder advantages" value={profile.founderAdvantages} onChange={update('founderAdvantages')} placeholder="skills, access, insight, audience" />
              <Field multiline label="12-month goals" value={profile.goals} onChange={update('goals')} placeholder="customers, revenue, product, hiring" />
              <div style={{ gridColumn:'1 / -1' }}><Field multiline label="Constraints" value={profile.constraints} onChange={update('constraints')} placeholder="budget, time, regulation, team, technology" /></div>
              <div style={{ gridColumn:'1 / -1', marginTop:8, paddingTop:18, borderTop:`1px solid ${theme.hair}` }}><div style={{ color:theme.ember, fontSize:10, letterSpacing:'.2em', textTransform:'uppercase', marginBottom:5 }}>financial assumptions</div><div style={{ color:theme.textMute, fontSize:10, lineHeight:1.5 }}>These inputs drive SOMA’s deterministic 36-month model. You can branch alternatives later without changing the approved plan.</div></div>
              {[['startingCapital','Starting capital ($)'],['startingCustomers','Starting customers'],['monthlyPrice','Monthly price ($)'],['customerAcquisitionCost','Customer acquisition cost ($)'],['monthlyCustomerGrowthPct','Monthly growth (%)'],['monthlyChurnPct','Monthly churn (%)'],['grossMarginPct','Gross margin (%)'],['fixedMonthlyCosts','Fixed monthly costs ($)'],['variableCostPerCustomer','Variable cost / customer ($)'],['oneTimeStartupCosts','One-time startup costs ($)']].map(([field,label]) => <Field key={field} label={label} value={profile.financialAssumptions?.[field] ?? ''} onChange={updateFinancial(field)} placeholder="0" />)}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}><button onClick={generate} disabled={thinking} style={{ padding:'11px 24px', background:theme.ember, border:'none', borderRadius:4, color:theme.voidDeep, cursor:thinking?'wait':'pointer', fontSize:10, fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase' }}>{thinking ? 'soma is building…' : plan ? 'rebuild the plan →' : 'build the plan →'}</button></div>
          </> : view === 'progress' ? <>
            <div style={{ padding:'26px clamp(20px,4vw,38px)', border:`1px solid ${theme.hair}`, background:'oklch(0.13 0.012 55 / 0.90)', borderRadius:6 }}>
              <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:20, marginBottom:14 }}>
                <div><div style={{ color:theme.ember, fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase' }}>{job?.currentLabel || 'Preparing the council'}</div><div style={{ marginTop:7, color:theme.textMute, fontSize:11 }}>Elapsed {elapsedLabel(job?.elapsedMs)} · the job continues on SOMA’s server if you leave this room</div></div>
                <div style={{ color:theme.text, fontSize:24, fontFamily:"'Fraunces',Georgia,serif" }}>{job?.progress || 0}%</div>
              </div>
              <div style={{ height:3, background:theme.hair, marginBottom:24 }}><div style={{ width:`${job?.progress || 0}%`, height:'100%', background:theme.ember, transition:'width .6s ease' }} /></div>
              <div style={{ display:'grid', gap:8 }}>
                {(job?.stages || []).map((stage, index) => <div key={stage.id} style={{ display:'grid', gridTemplateColumns:'28px minmax(0,1fr) auto', alignItems:'center', gap:10, minHeight:34, padding:'0 10px', border:`1px solid ${stage.status === 'running' ? theme.ember : theme.hair}`, background:stage.status === 'running' ? 'oklch(0.22 0.045 60 / .42)' : 'transparent', borderRadius:4 }}>
                  <span style={{ color:stage.status === 'completed' ? theme.ember : theme.textMute, fontFamily:"'JetBrains Mono',monospace", fontSize:10 }}>{stage.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span>
                  <span style={{ color:stage.status === 'running' ? theme.text : theme.textDim, fontSize:12 }}>{stage.label}</span>
                  <span style={{ color:theme.textMute, fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase' }}>{stage.status}{stage.durationMs ? ` · ${elapsedLabel(stage.durationMs)}` : ''}</span>
                </div>)}
              </div>
              {!!job?.participants?.length && <div style={{ marginTop:24 }}><div style={{ color:theme.textMute, fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:9 }}>participating minds</div><div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>{job.participants.map((person) => <span key={`${person.name}-${person.role}`} style={{ padding:'6px 9px', border:`1px solid ${theme.hair}`, borderRadius:20, color:theme.textDim, fontSize:10 }}>{person.name} · {person.role}</span>)}</div></div>}
              {job?.evidence?.status && job.evidence.status !== 'pending' && <div style={{ marginTop:18, color:theme.textMute, fontSize:11 }}>Evidence status: {job.evidence.status.replaceAll('_', ' ')} · {job.evidence.sources?.length || 0} live source candidates</div>}
              {(job?.status === 'failed' || job?.status === 'cancelled') && <button onClick={generate} style={{ marginTop:22, padding:'9px 14px', background:theme.ember, border:'none', borderRadius:3, color:theme.voidDeep, cursor:'pointer', fontSize:9, letterSpacing:'0.17em', textTransform:'uppercase' }}>start a fresh build</button>}
              {isRunningJob(job) && <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}><button onClick={cancel} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textMute, cursor:'pointer', fontSize:9, letterSpacing:'0.16em', textTransform:'uppercase' }}>cancel build</button></div>}
            </div>
          </> : <>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
              {[['plan','plan + collaborate'],['market','market + pricing'],['finance','financial model'],['evidence','evidence'],['operate','operate'],['scenarios','scenarios'],['history','history']].map(([id,label]) => <button key={id} onClick={() => setWorkspaceTab(id)} style={{ padding:'7px 10px', background:workspaceTab === id ? 'oklch(0.25 0.055 65)' : 'transparent', border:`1px solid ${workspaceTab === id ? theme.ember : theme.hair}`, borderRadius:3, color:workspaceTab === id ? theme.ember : theme.textMute, cursor:'pointer', fontSize:9, letterSpacing:'.13em', textTransform:'uppercase' }}>{label}</button>)}
            </div>
            {arbiteriumHandoff && <div style={{ marginBottom:14, padding:'11px 13px', border:`1px solid ${theme.ember}`, borderRadius:4, background:'oklch(0.19 0.035 60 / .55)', color:theme.textDim, fontSize:10, lineHeight:1.55 }}>Arbiterium handoff prepared · {arbiteriumHandoff.steps?.length || 0} evidence, risk, and operator gates · workflow {arbiteriumHandoff.id}</div>}
            {workspaceTab === 'plan' ? <>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginBottom:14 }}>
              {previewPlan && <button onClick={() => setPreviewPlan('')} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.ember}`, borderRadius:3, color:theme.ember, cursor:'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>return to current</button>}
              <button onClick={() => navigator.clipboard?.writeText(previewPlan || plan)} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textDim, cursor:'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>copy</button>
              <button onClick={exportPlan} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textDim, cursor:'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>export markdown</button>
              <button onClick={() => downloadModelExport('xlsx')} disabled={!!exporting} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textDim, cursor:exporting?'wait':'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>{exporting === 'xlsx' ? 'building…' : 'excel model'}</button>
              <button onClick={() => downloadModelExport('pdf')} disabled={!!exporting} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textDim, cursor:exporting?'wait':'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>{exporting === 'pdf' ? 'building…' : 'pdf deck'}</button>
              <button onClick={prepareArbiterium} style={{ padding:'8px 12px', background:'transparent', border:`1px solid ${theme.ember}`, borderRadius:3, color:theme.ember, cursor:'pointer', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase' }}>prepare Arbiterium</button>
              <button onClick={generate} disabled={thinking} style={{ padding:'8px 12px', background:theme.ember, border:'none', borderRadius:3, color:theme.voidDeep, cursor:thinking?'wait':'pointer', fontSize:9, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase' }}>{thinking?'rebuilding…':'regenerate'}</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.65fr) minmax(300px,.75fr)', alignItems:'start', gap:16 }}>
              <article style={{ padding:'34px clamp(24px,4vw,48px)', border:`1px solid ${previewPlan ? theme.ember : theme.hair}`, background:'oklch(0.13 0.012 55 / 0.90)', borderRadius:6 }}>
                {previewPlan && <div style={{ marginBottom:22, color:theme.ember, fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase' }}>revision preview · not applied</div>}
                <ReactMarkdown components={markdownComponents}>{previewPlan || plan}</ReactMarkdown>
              </article>
              <aside style={{ position:'sticky', top:0, border:`1px solid ${theme.hair}`, background:'oklch(0.12 0.012 55 / .96)', borderRadius:6, overflow:'hidden' }}>
                <div style={{ padding:'15px 16px', borderBottom:`1px solid ${theme.hair}` }}>
                  <div style={{ color:theme.ember, fontSize:9, letterSpacing:'0.22em', textTransform:'uppercase' }}>build with SOMA</div>
                  <div style={{ marginTop:6, color:theme.textMute, fontSize:10, lineHeight:1.5 }}>Brainstorm freely, explore what-if scenarios, challenge assumptions, or request an actual plan change.</div>
                </div>
                <div style={{ maxHeight:430, overflowY:'auto', padding:14, display:'grid', gap:10 }}>
                  {(job?.collaboration?.messages || []).map((message) => <div key={message.id} style={{ justifySelf:message.role === 'user' ? 'end' : 'start', maxWidth:'92%', padding:'9px 11px', borderRadius:message.role === 'user' ? '8px 8px 2px 8px' : '8px 8px 8px 2px', background:message.role === 'user' ? 'oklch(0.25 0.06 65 / .72)' : 'oklch(0.18 0.018 55)', border:`1px solid ${message.role === 'user' ? 'oklch(0.46 0.08 65)' : theme.hair}`, color:theme.textDim, fontSize:11, lineHeight:1.55 }}>{message.content}</div>)}
                  {!job?.collaboration?.messages?.length && <div style={{ color:theme.textMute, fontSize:11, lineHeight:1.6 }}>Your collaboration history will stay with this plan.</div>}
                </div>
                {revision && (isRunningRevision(revision) || revision.status === 'proposed') && <div style={{ margin:'0 14px 12px', padding:12, border:`1px solid ${revision.status === 'proposed' ? theme.ember : theme.hair}`, borderRadius:4, background:'oklch(0.17 0.02 58)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:8, color:theme.text, fontSize:10 }}><span>{revision.currentLabel}</span><span style={{ color:theme.ember }}>{revision.progress}%</span></div>
                  <div style={{ height:2, background:theme.hair, margin:'9px 0 10px' }}><div style={{ width:`${revision.progress}%`, height:'100%', background:theme.ember, transition:'width .5s' }} /></div>
                  {!!revision.selectedSpecialists?.length && <div style={{ color:theme.textMute, fontSize:9, lineHeight:1.5 }}>{revision.selectedSpecialists.join(' · ')}</div>}
                  {revision.status === 'proposed' && <>
                    {!!revision.changedSections?.length && <div style={{ marginTop:8, color:theme.textDim, fontSize:9, lineHeight:1.5 }}>Touches: {revision.changedSections.join(', ')}</div>}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:11 }}>
                      <button onClick={() => setPreviewPlan(revision.revisedPlan)} style={{ gridColumn:'1 / -1', padding:'7px 9px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textDim, cursor:'pointer', fontSize:9, textTransform:'uppercase', letterSpacing:'.12em' }}>preview proposal</button>
                      <button onClick={discardRevision} style={{ padding:'7px 9px', background:'transparent', border:`1px solid ${theme.hair}`, borderRadius:3, color:theme.textMute, cursor:'pointer', fontSize:9, textTransform:'uppercase', letterSpacing:'.12em' }}>keep current</button>
                      <button onClick={applyRevision} style={{ padding:'7px 9px', background:theme.ember, border:'none', borderRadius:3, color:theme.voidDeep, cursor:'pointer', fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.12em' }}>apply</button>
                    </div>
                  </>}
                </div>}
                <form onSubmit={requestRevision} style={{ padding:12, borderTop:`1px solid ${theme.hair}` }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, marginBottom:9 }}>
                    <button type="button" onClick={() => setCollaborationMode('exploration')} style={{ padding:7, background:collaborationMode === 'exploration' ? 'oklch(0.24 0.05 65)' : 'transparent', border:`1px solid ${collaborationMode === 'exploration' ? theme.ember : theme.hair}`, color:collaborationMode === 'exploration' ? theme.ember : theme.textMute, borderRadius:3, cursor:'pointer', fontSize:9, textTransform:'uppercase', letterSpacing:'.12em' }}>explore idea</button>
                    <button type="button" onClick={() => setCollaborationMode('revision')} style={{ padding:7, background:collaborationMode === 'revision' ? 'oklch(0.24 0.05 65)' : 'transparent', border:`1px solid ${collaborationMode === 'revision' ? theme.ember : theme.hair}`, color:collaborationMode === 'revision' ? theme.ember : theme.textMute, borderRadius:3, cursor:'pointer', fontSize:9, textTransform:'uppercase', letterSpacing:'.12em' }}>change plan</button>
                  </div>
                  <textarea rows={3} value={revisionInput} onChange={(event) => setRevisionInput(event.target.value)} disabled={sendingRevision || isRunningRevision(revision) || revisionNeedsDecision} placeholder={revisionNeedsDecision ? 'Review the proposal above first…' : 'Brainstorm, ask “what if…”, or request a change'} style={{ width:'100%', boxSizing:'border-box', resize:'vertical', padding:'9px 10px', background:'oklch(0.10 0.01 50)', border:`1px solid ${theme.hair}`, borderRadius:4, color:theme.text, fontSize:11, lineHeight:1.5, outline:'none' }} />
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                    <span style={{ color:theme.textMute, fontSize:9 }}>{job?.collaboration?.versions?.length || 0} saved version{job?.collaboration?.versions?.length === 1 ? '' : 's'}</span>
                    <button type="submit" disabled={!revisionInput.trim() || sendingRevision || isRunningRevision(revision) || revisionNeedsDecision} style={{ padding:'7px 11px', background:theme.ember, border:'none', borderRadius:3, color:theme.voidDeep, opacity:!revisionInput.trim() || isRunningRevision(revision) || revisionNeedsDecision ? .4 : 1, cursor:sendingRevision || isRunningRevision(revision) ? 'wait' : 'pointer', fontSize:9, fontWeight:600, letterSpacing:'.14em', textTransform:'uppercase' }}>{sendingRevision ? 'routing…' : isRunningRevision(revision) ? 'specialists working…' : revisionNeedsDecision ? 'review proposal' : 'send to council'}</button>
                  </div>
                </form>
              </aside>
            </div>
            </> : <BusinessWorkspacePanels tab={workspaceTab} job={job} setJob={setJob} theme={theme} onError={setError} />}
          </>}
        </div>
      </div>
    </div>
  );
}
