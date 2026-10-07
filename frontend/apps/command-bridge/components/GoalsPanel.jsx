import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Target,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  Brain,
  Repeat2,
  ShieldCheck,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

const API = '/api/soma';

const PRIORITY_COLOR = {
  critical: 'text-red-400 border-red-900/40 bg-red-950/20',
  high: 'text-amber-400 border-amber-900/40 bg-amber-950/20',
  medium: 'text-blue-400 border-blue-900/40 bg-blue-950/20',
  low: 'text-zinc-500 border-zinc-800/60 bg-zinc-900/30'
};

const STATUS_ICON = {
  active: <Clock className="w-3 h-3 text-blue-400" />,
  completed: <CheckCircle className="w-3 h-3 text-emerald-400" />,
  failed: <AlertCircle className="w-3 h-3 text-red-400" />
};

const priorityValue = (priority) => {
  if (typeof priority === 'number') return priority;
  return { critical: 95, high: 80, medium: 55, low: 30 }[priority] || 50;
};

function MiniMetric({ icon: Icon, label, value, tone = 'text-zinc-200' }) {
  return (
    <div className="rounded-lg bg-zinc-900/50 border border-white/5 p-2 min-w-0">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-zinc-500">
        <Icon className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-sm font-mono font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function GoalRow({ goal, onDelete, onComplete, onRetest }) {
  const [open, setOpen] = useState(false);
  const colorClass = PRIORITY_COLOR[goal.priority] || PRIORITY_COLOR.medium;
  const status = goal.status || (!goal.completedAt && !goal.failedAt ? 'active' : goal.completedAt ? 'completed' : 'failed');
  const isActive = status !== 'completed' && status !== 'failed' && status !== 'deferred' && status !== 'cancelled';
  const contract = goal.metadata?.goalContract || {};
  const verification = goal.metadata?.lastVerification;
  const lesson = goal.metadata?.learningLesson;
  const progress = goal.metrics?.progress ?? goal.progress ?? 0;
  const verifyPassed = verification?.passed === true;
  const verifyFailed = verification?.passed === false || status === 'verification_failed';
  const criteria = contract.successCriteria || goal.metadata?.successCriteria || [];
  const requiredEvidence = contract.evidenceRequired || goal.metadata?.evidenceRequired || [];

  return (
    <div className={`rounded-lg border ${colorClass}`}>
      <div className="px-3 py-2.5 flex items-center space-x-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
          title={open ? 'Hide contract' : 'Show contract'}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <div className="shrink-0">
          {STATUS_ICON[isActive ? 'active' : goal.completedAt ? 'completed' : 'failed'] || <AlertCircle className="w-3 h-3 text-amber-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-zinc-200 text-[11px] font-semibold truncate">{goal.title}</div>
          {goal.description && goal.description !== goal.title && (
            <div className="text-zinc-600 text-[10px] truncate">{goal.description}</div>
          )}
          <div className="flex items-center space-x-2 mt-0.5 min-w-0">
            <span className="text-[9px] font-bold uppercase tracking-widest opacity-70 truncate">{goal.category || 'general'}</span>
            <span className="text-[9px] uppercase tracking-widest text-zinc-600 shrink-0">{contract.ownerLobe || goal.metadata?.ownerLobe || 'unrouted'}</span>
            <div className="flex items-center space-x-1 shrink-0">
              <div className="w-12 bg-zinc-800 rounded-full h-0.5">
                <div
                  className={`h-0.5 rounded-full ${verifyFailed ? 'bg-amber-500' : verifyPassed ? 'bg-emerald-500' : 'bg-fuchsia-500'}`}
                  style={{ width: `${Math.min(progress || 0, 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-zinc-600">{progress || 0}%</span>
            </div>
          </div>
        </div>

        {verifyFailed && (
          <button
            onClick={() => onRetest(goal.id)}
            className="shrink-0 text-amber-500 hover:text-amber-300 transition-colors"
            title="Create retest goal"
          >
            <Repeat2 className="w-3.5 h-3.5" />
          </button>
        )}
        {isActive && (
          <button
            onClick={() => onComplete(goal.id)}
            className="shrink-0 text-emerald-600 hover:text-emerald-400 transition-colors"
            title="Mark complete with evidence"
          >
            <CheckCircle className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(goal.id)}
          className="shrink-0 text-zinc-700 hover:text-red-400 transition-colors"
          title="Delete goal"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 ml-7 space-y-2 text-[10px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-black/20 border border-white/5 p-2">
              <div className="text-zinc-500 uppercase tracking-widest mb-1">Success Criteria</div>
              <ul className="space-y-1 text-zinc-300">
                {criteria.slice(0, 3).map((item, i) => (
                  <li key={i} className="leading-snug">- {item}</li>
                ))}
                {!criteria.length && <li className="text-zinc-600">No criteria recorded</li>}
              </ul>
            </div>
            <div className="rounded-lg bg-black/20 border border-white/5 p-2">
              <div className="text-zinc-500 uppercase tracking-widest mb-1">Evidence</div>
              <div className={verifyPassed ? 'text-emerald-300' : verifyFailed ? 'text-amber-300' : 'text-zinc-400'}>
                {verification ? `${verifyPassed ? 'Passed' : 'Failed'} - ${verification.score || 0}%` : 'Not verified yet'}
              </div>
              {requiredEvidence.slice(0, 3).map((item, i) => (
                <div key={i} className="text-zinc-500 mt-1">requires: {item}</div>
              ))}
            </div>
          </div>
          {lesson && (
            <div className="rounded-lg bg-black/20 border border-white/5 p-2">
              <div className="text-zinc-500 uppercase tracking-widest mb-1">Last Lesson</div>
              <div className="text-zinc-300 leading-snug">{lesson.lesson || lesson.signal}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GoalsPanel({ isConnected }) {
  const [data, setData] = useState(null);
  const [learning, setLearning] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'general', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('active');
  const [message, setMessage] = useState(null);

  const loadInFlight = useRef(false);
  const load = useCallback(() => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    Promise.allSettled([
      fetch(`${API}/goals`).then(r => r.json()),
      fetch(`${API}/learning-spine/status`).then(r => r.json())
    ])
      .then(([goalsRes, learningRes]) => {
        if (goalsRes.status === 'fulfilled') setData(goalsRes.value);
        if (learningRes.status === 'fulfilled') setLearning(learningRes.value);
      })
      .catch(() => {})
      .finally(() => { loadInFlight.current = false; });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 5000);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) flash(payload.error || payload.goal?.error || 'Goal was rejected by quality gate.');
      else flash('Goal created with a learning contract.');
      setForm({ title: '', description: '', category: 'general', priority: 'medium' });
      setShowAdd(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/goals/${id}`, { method: 'DELETE' });
    load();
  };

  const handleComplete = async (id) => {
    const summary = window.prompt('Completion evidence or summary?');
    if (!summary) return;
    const res = await fetch(`${API}/goals/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, nextStep: 'Review distilled lesson and retest if verification fails.' })
    });
    const payload = await res.json().catch(() => ({}));
    flash(payload.success ? 'Goal verified and completed.' : (payload.error || 'Goal did not pass verification.'));
    load();
  };

  const handleRetest = async (id) => {
    const res = await fetch(`${API}/learning-spine/retest/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const payload = await res.json().catch(() => ({}));
    flash(payload.success ? 'Retest goal created.' : (payload.error || payload.retest?.error || 'Retest could not be created.'));
    load();
  };

  const allGoals = data?.goals || [];
  const activeGoals = allGoals.filter(g => !g.completedAt && !g.failedAt && !['completed', 'failed', 'deferred', 'cancelled'].includes(g.status));
  const failedGoals = allGoals.filter(g => g.status === 'verification_failed' || g.metadata?.lastVerification?.passed === false);
  const domains = Object.values(learning?.learning?.scoreboard?.domains || {});
  const displayGoals = (filter === 'active' ? activeGoals : filter === 'failed' ? failedGoals : allGoals)
    .slice()
    .sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority));

  const missingContracts = learning?.goals?.missingContract ?? 0;
  const verifiedCount = domains.reduce((sum, d) => sum + (d.verified || 0), 0);

  const cardClass = 'bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg';

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center uppercase tracking-wider">
          <Target className="w-4 h-4 mr-2 text-fuchsia-400" />
          Goals
          {activeGoals.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-400 text-[9px] font-bold">{activeGoals.length}</span>
          )}
        </h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFilter(f => f === 'active' ? 'failed' : f === 'failed' ? 'all' : 'active')}
            className="text-[9px] uppercase tracking-widest text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {filter === 'active' ? 'Failed' : filter === 'failed' ? 'All' : 'Active'}
          </button>
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-400 text-[10px] font-bold transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniMetric icon={Brain} label="Contracts" value={`${missingContracts} missing`} tone={missingContracts ? 'text-amber-300' : 'text-emerald-300'} />
        <MiniMetric icon={ShieldCheck} label="Verified" value={verifiedCount} />
        <MiniMetric icon={Repeat2} label="Failed" value={failedGoals.length} tone={failedGoals.length ? 'text-amber-300' : 'text-zinc-200'} />
      </div>

      {message && (
        <div className="mb-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-zinc-300">
          {message}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-4 bg-zinc-900/60 rounded-xl p-4 border border-white/5 space-y-3">
          <input
            type="text"
            placeholder="Goal title..."
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-zinc-200 text-xs placeholder-zinc-600 focus:outline-none focus:border-fuchsia-500/50"
          />
          <input
            type="text"
            placeholder="Description or why it matters..."
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-zinc-200 text-xs placeholder-zinc-600 focus:outline-none focus:border-fuchsia-500/50"
          />
          <div className="flex items-center space-x-3">
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="flex-1 bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-zinc-400 text-xs focus:outline-none"
            >
              <option value="general">General</option>
              <option value="research">Research</option>
              <option value="engineering">Engineering</option>
              <option value="medical">Medical</option>
              <option value="social">Social</option>
              <option value="trading">Trading</option>
              <option value="creative">Creative</option>
            </select>
            <select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="flex-1 bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-zinc-400 text-xs focus:outline-none"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button
              type="submit"
              disabled={saving || !form.title.trim()}
              className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs font-bold transition-colors"
            >
              {saving ? '...' : 'Add'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
        {displayGoals.length === 0 ? (
          <div className="text-center py-6 text-zinc-700">
            <Target className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">{filter === 'active' ? 'No active goals.' : filter === 'failed' ? 'No verification failures.' : 'No goals yet.'}</p>
            <p className="text-[10px] mt-1 opacity-60">Every new goal now gets a contract and evidence gate.</p>
          </div>
        ) : (
          displayGoals.slice(0, 20).map(g => (
            <GoalRow key={g.id} goal={g} onDelete={handleDelete} onComplete={handleComplete} onRetest={handleRetest} />
          ))
        )}
      </div>

      {displayGoals.length > 20 && (
        <div className="text-center mt-2 text-[10px] text-zinc-700">
          +{displayGoals.length - 20} more goals
        </div>
      )}
    </div>
  );
}
