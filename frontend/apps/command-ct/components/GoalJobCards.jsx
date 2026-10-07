import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleEllipsis, LoaderCircle, RotateCcw, ShieldAlert, Square } from 'lucide-react';

const STATUS = {
  queued: { label: 'Queued', icon: CircleEllipsis, color: 'text-zinc-400 border-zinc-500/20' },
  executing: { label: 'Executing', icon: LoaderCircle, color: 'text-cyan-300 border-cyan-500/30' },
  verifying: { label: 'Verifying', icon: LoaderCircle, color: 'text-violet-300 border-violet-500/30' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-emerald-300 border-emerald-500/30' },
  blocked: { label: 'Blocked', icon: ShieldAlert, color: 'text-amber-300 border-amber-500/30' },
  cancelled: { label: 'Cancelled', icon: Square, color: 'text-zinc-400 border-zinc-500/20' }
};

const basename = value => String(value || '').split(/[\\/]/).pop();
const evidenceUrl = value => `/api/soma/work-evidence?path=${encodeURIComponent(value)}`;
const relativeTime = value => value ? new Date(value).toLocaleString() : 'Not recorded';

export function GoalJobCards({ jobs = [], onCancel, onRetry }) {
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (!jobs.length) return null;

  const act = async (kind, job) => {
    setBusy(`${kind}:${job.id}`);
    setError('');
    try { await (kind === 'retry' ? onRetry?.(job.id) : onCancel?.(job.id)); }
    catch (cause) { setError(cause.message || String(cause)); }
    finally { setBusy(null); }
  };

  return (
    <aside className="mx-4 mb-3 rounded-2xl border border-white/5 bg-[#111114]/90 p-3" aria-label="Background jobs">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Activity center</span>
        <span className="text-[10px] text-zinc-600">{jobs.length} recent</span>
      </div>
      {error && <p role="alert" className="mb-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">{error}</p>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map(job => {
          const style = STATUS[job.status] || STATUS.queued;
          const Icon = style.icon;
          const open = expanded === job.id;
          const running = ['queued', 'executing', 'verifying'].includes(job.status);
          return (
            <article key={job.id} className={`min-w-0 rounded-xl border bg-white/[0.025] px-3 py-2 ${style.color}`} data-goal-status={job.status}>
              <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded(open ? null : job.id)} aria-expanded={open}>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${['executing', 'verifying'].includes(job.status) ? 'animate-spin' : ''}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider">{style.label}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{Math.round(job.progress || 0)}%</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-current transition-all" style={{ width: `${Math.max(2, Math.min(100, job.progress || 0))}%` }} /></div>
              <p className="mt-1 truncate text-xs text-zinc-200" title={job.title}>{job.title}</p>
              {(job.artifact || job.receipt) && (
                <div className="mt-1 flex gap-2 text-[10px] text-zinc-500">
                  {job.artifact && <a className="hover:text-cyan-300 hover:underline" href={evidenceUrl(job.artifact)} target="_blank" rel="noreferrer">Artifact: {basename(job.artifact)}</a>}
                  {job.receipt && <a className="hover:text-cyan-300 hover:underline" href={evidenceUrl(job.receipt)} target="_blank" rel="noreferrer">Receipt: {basename(job.receipt)}</a>}
                </div>
              )}
              {open && (
                <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-zinc-500">
                  <div className="grid grid-cols-2 gap-1"><span>Started</span><span className="text-right text-zinc-400">{relativeTime(job.startedAt || job.createdAt)}</span><span>Attempts</span><span className="text-right text-zinc-400">{job.attempts || 0}{job.maxAttempts ? ` / ${job.maxAttempts}` : ''}</span></div>
                  {job.reason && <p className="mt-2 rounded bg-amber-500/5 p-2 text-amber-200/70">{job.reason}</p>}
                  {job.timeline?.length > 0 && <ol className="mt-2 max-h-24 overflow-auto border-l border-white/10 pl-2">{job.timeline.slice(-5).map((step, index) => <li key={`${step.at}-${index}`} className="mb-1">{step.from} → {step.to} · {relativeTime(step.at)}</li>)}</ol>}
                  <div className="mt-2 flex gap-2">
                    {running && <button disabled={!!busy} onClick={() => act('cancel', job)} className="flex items-center gap-1 rounded bg-rose-500/10 px-2 py-1 text-rose-300 hover:bg-rose-500/20"><Square className="h-3 w-3" /> Cancel</button>}
                    {!running && job.status !== 'completed' && <button disabled={!!busy} onClick={() => act('retry', job)} className="flex items-center gap-1 rounded bg-cyan-500/10 px-2 py-1 text-cyan-300 hover:bg-cyan-500/20"><RotateCcw className="h-3 w-3" /> Retry</button>}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

