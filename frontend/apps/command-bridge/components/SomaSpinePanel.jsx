import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle,
  FileCheck,
  Layers,
  Network,
  PackageOpen,
  RefreshCw,
  Send,
  Server,
  Sparkles,
  Zap
} from 'lucide-react';
import somaBackend from '../somaBackend';
import './SomaSpinePanel.css';

const classNames = (...parts) => parts.filter(Boolean).join(' ');

function Metric({ label, value, tone = 'zinc' }) {
  const tones = {
    emerald: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
    blue: 'text-blue-300 border-blue-500/20 bg-blue-500/10',
    fuchsia: 'text-fuchsia-300 border-fuchsia-500/20 bg-fuchsia-500/10',
    amber: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
    zinc: 'text-zinc-300 border-white/10 bg-white/5'
  };
  return (
    <div className={classNames('rounded-lg border px-4 py-3', tones[tone])}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? 0}</div>
    </div>
  );
}

function StatusPill({ loaded, runtime }) {
  if (loaded) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <CheckCircle className="h-3 w-3" /> Loaded
      </span>
    );
  }
  if (runtime) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
        <Zap className="h-3 w-3" /> Callable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
      <PackageOpen className="h-3 w-3" /> Manifest
    </span>
  );
}

function ReadinessPill({ status }) {
  const tones = {
    ready: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    partial: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    missing: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400',
    broken: 'border-red-500/20 bg-red-500/10 text-red-300'
  };
  return (
    <span className={classNames(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      tones[status] || tones.missing
    )}>
      {status || 'unknown'}
    </span>
  );
}

function ReadinessPanel({ readiness }) {
  if (!readiness) return null;
  const counts = readiness.counts || {};
  const topCapabilities = readiness.capabilities || [];

  return (
    <section className="mb-4 rounded-xl border border-white/5 bg-[#0d0d10] p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-emerald-300" />
            <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Readiness Scanner</h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Real implementation scan. TODOs and docs do not count as ready.</p>
        </div>
        <div className="flex items-center gap-3">
          <ReadinessPill status={readiness.status} />
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-zinc-100">{readiness.score ?? 0}%</div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-600">overall</div>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {['ready', 'partial', 'missing', 'broken'].map(status => (
          <div key={status} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-zinc-600">{status}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-200">{counts[status] || 0}</div>
          </div>
        ))}
      </div>

      {readiness.topGaps?.length > 0 && (
        <div className="mb-4 grid gap-2 lg:grid-cols-2">
          {readiness.topGaps.slice(0, 4).map(gap => (
            <div key={gap.id} className="rounded-lg border border-amber-500/10 bg-amber-500/[0.04] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-semibold text-zinc-200">{gap.label}</span>
                <ReadinessPill status={gap.status} />
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{gap.blocker}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        {topCapabilities.map(item => {
          const firstGap = item.checks?.find(check => check.status !== 'ready');
          return (
            <div key={item.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-200">{item.label}</div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-600">{item.group}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-zinc-500">{item.score}%</span>
                  <ReadinessPill status={item.status} />
                </div>
              </div>
              {firstGap && (
                <div className="mt-2 truncate text-[11px] text-zinc-500">
                  {firstGap.label}: {firstGap.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExpertiseRow({ pkg, onLoad, onUse, loadingId, selected }) {
  const isLoading = loadingId === pkg.id;
  return (
    <div className={classNames(
      'rounded-lg border bg-[#111114] px-4 py-3 transition-colors',
      selected ? 'border-fuchsia-500/30 bg-fuchsia-500/[0.04]' : 'border-white/5'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100">{pkg.name}</h3>
            <StatusPill loaded={pkg.loaded} runtime={pkg.runtime} />
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">{pkg.id}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onUse(pkg)}
            className="spine-action-button spine-action-button-use"
          >
            <span><ArrowRight /> Use</span>
          </button>
          <button
            type="button"
            onClick={() => onLoad(pkg.id)}
            disabled={pkg.loaded || isLoading}
            className={classNames(
              'spine-action-button',
              pkg.loaded
                ? 'spine-action-button-ready'
                : 'spine-action-button-load',
              isLoading && 'spine-action-button-loading'
            )}
          >
            <span>
              {isLoading ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {pkg.loaded ? 'Ready' : isLoading ? 'Loading' : 'Load'}
            </span>
          </button>
        </div>
      </div>
      {pkg.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-500">{pkg.description}</p>
      )}
      {pkg.capabilities?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pkg.capabilities.slice(0, 6).map(capability => (
            <span key={capability} className="rounded border border-white/5 bg-black/20 px-2 py-1 text-[10px] text-zinc-400">
              {capability}
            </span>
          ))}
        </div>
      )}
      {pkg.standards?.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-600">
          <FileCheck className="h-3 w-3 text-blue-400" />
          {pkg.standards.slice(0, 5).join(' / ')}
        </div>
      )}
    </div>
  );
}

export default function SomaSpinePanel({ isConnected }) {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [lifecycle, setLifecycle] = useState([]);
  const [probe, setProbe] = useState('review this audit workpaper for duplicate invoices and footing issues');
  const [matches, setMatches] = useState([]);
  const [probeBusy, setProbeBusy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [selectedExpertise, setSelectedExpertise] = useState(null);
  const [answer, setAnswer] = useState(null);

  const fetchRuntime = async () => {
    try {
      const data = await somaBackend.fetch('/api/runtime/map');
      setRuntime(data.runtime);
      setError(null);
    } catch (err) {
      setError(err.message || 'Runtime map unavailable');
    }
  };

  useEffect(() => {
    fetchRuntime();
    const timer = setInterval(fetchRuntime, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleLifecycle = (event) => {
      setLifecycle(prev => [event, ...prev].slice(0, 8));
      fetchRuntime();
    };
    somaBackend.on('soma_lifecycle', handleLifecycle);
    return () => somaBackend.off('soma_lifecycle', handleLifecycle);
  }, []);

  const groupedExpertises = useMemo(() => {
    const packages = runtime?.expertises?.packages || [];
    return packages.reduce((groups, pkg) => {
      const group = pkg.parent || pkg.id.split('/')[0] || 'general';
      groups[group] = groups[group] || [];
      groups[group].push(pkg);
      return groups;
    }, {});
  }, [runtime]);

  const loadExpertise = async (id) => {
    setLoadingId(id);
    setLifecycle(prev => [{
      event: 'ui.expertise.loading',
      message: `Loading ${id} expertise...`,
      expertise: { id },
      timestamp: Date.now()
    }, ...prev].slice(0, 8));
    try {
      await somaBackend.fetch('/api/expertises/load', {
        method: 'POST',
        body: JSON.stringify({ id })
      });
      await fetchRuntime();
    } catch (err) {
      setError(err.message || `Failed to load ${id}`);
    } finally {
      setLoadingId(null);
    }
  };

  const matchProbe = async () => {
    const query = probe.trim();
    if (!query) return;
    setProbeBusy(true);
    setError(null);
    try {
      const data = await somaBackend.fetch('/api/expertises/match', {
        method: 'POST',
        body: JSON.stringify({ query, limit: 5 })
      });
      const nextMatches = data.matches || [];
      setMatches(nextMatches);
      if (nextMatches[0]) setSelectedExpertise(nextMatches[0]);
    } catch (err) {
      setError(err.message || 'Expertise match failed');
    } finally {
      setProbeBusy(false);
    }
  };

  const askWithRouting = async () => {
    const query = probe.trim();
    if (!query) return;
    setAskBusy(true);
    setAnswer(null);
    setError(null);
    try {
      const data = await somaBackend.fetch('/api/soma/reason', {
        method: 'POST',
        body: JSON.stringify({
          query,
          context: { source: 'spine' }
        })
      });
      setAnswer(data);
      if (data.expertise) setSelectedExpertise(data.expertise);
      if (data.statusMessages?.length) {
        setLifecycle(prev => [...data.statusMessages, ...prev].slice(0, 8));
      }
      await fetchRuntime();
    } catch (err) {
      setError(err.message || 'SOMA reason request failed');
    } finally {
      setAskBusy(false);
    }
  };

  const useExpertise = (pkg) => {
    setSelectedExpertise(pkg);
    setProbe(current => {
      const text = current.trim();
      if (!text) return `Use ${pkg.name} to analyze: `;
      return text;
    });
  };

  const counts = runtime?.counts || {};
  const readiness = runtime?.readiness;

  return (
    <div className="h-full overflow-y-auto bg-[#09090b] p-6 text-zinc-200 custom-scrollbar">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fuchsia-300">
            <Network className="h-4 w-4" /> Spine
          </div>
          <h2 className="mt-1 text-2xl font-semibold text-zinc-50">Runtime and Expertise Map</h2>
        </div>
        <button
          type="button"
          onClick={fetchRuntime}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 hover:bg-white/10"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Connection" value={isConnected ? 'Live' : 'Offline'} tone={isConnected ? 'emerald' : 'amber'} />
        <Metric label="Components" value={counts.components} tone="blue" />
        <Metric label="Active" value={counts.active} tone="emerald" />
        <Metric label="Expertises" value={counts.expertises} tone="fuchsia" />
        <Metric label="Tools" value={counts.tools} tone="zinc" />
      </div>

      <ReadinessPanel readiness={readiness} />

      {runtime?.lastExpertiseRoute && (
        <div className="mb-4 rounded-xl border border-fuchsia-500/15 bg-fuchsia-500/[0.04] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-fuchsia-300">Last Route</div>
              <div className="mt-1 text-sm text-zinc-200">{runtime.lastExpertiseRoute.name}</div>
            </div>
            <div className="max-w-3xl truncate text-xs text-zinc-500">{runtime.lastExpertiseRoute.query}</div>
          </div>
        </div>
      )}

      <section className="mb-4 rounded-xl border border-white/5 bg-[#0d0d10] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-fuchsia-300" />
            <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Expertise Router</h3>
          </div>
          {selectedExpertise && (
            <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-200">
              Selected: {selectedExpertise.name || selectedExpertise.id}
            </span>
          )}
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <textarea
            value={probe}
            onChange={(event) => setProbe(event.target.value)}
            rows={1}
            className="min-h-[42px] resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-fuchsia-500/40"
            placeholder="Type a question or task to see which expertise SOMA would route to..."
          />
          <button
            type="button"
            onClick={matchProbe}
            disabled={probeBusy}
            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-500/20 disabled:cursor-wait disabled:opacity-60"
          >
            {probeBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
            Match
          </button>
          <button
            type="button"
            onClick={askWithRouting}
            disabled={askBusy}
            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-4 text-xs font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20 disabled:cursor-wait disabled:opacity-60"
          >
            {askBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </button>
        </div>
        {(matches.length > 0 || answer) && (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="space-y-2">
              {matches.map(match => (
                <button
                  key={match.id}
                  type="button"
                  onClick={() => setSelectedExpertise(match)}
                  className={classNames(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    selectedExpertise?.id === match.id ? 'border-fuchsia-500/30 bg-fuchsia-500/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-200">{match.name}</span>
                    <span className="text-xs font-mono text-fuchsia-300">{match.score}</span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-zinc-600">{(match.reasons || []).join('  ') || match.id}</div>
                </button>
              ))}
            </div>
            {answer && (
              <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-widest text-emerald-300">SOMA Answer</span>
                  <span className="text-[10px] text-zinc-500">{answer.expertise?.name || 'general route'}</span>
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                  {answer.response || answer.error || 'No response text returned.'}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section className="rounded-xl border border-white/5 bg-[#0d0d10] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-fuchsia-300" />
              <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Expertise Packages</h3>
            </div>
            <span className="text-xs text-zinc-500">{counts.loadedExpertises || 0} loaded</span>
          </div>

          <div className="space-y-5">
            {Object.entries(groupedExpertises).map(([group, packages]) => (
              <div key={group}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  <Layers className="h-3.5 w-3.5" /> {group}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {packages.map(pkg => (
                    <ExpertiseRow
                      key={pkg.id}
                      pkg={pkg}
                      onLoad={loadExpertise}
                      onUse={useExpertise}
                      loadingId={loadingId}
                      selected={selectedExpertise?.id === pkg.id}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!runtime && (
              <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-4 py-6 text-sm text-zinc-500">
                <Activity className="h-4 w-4 animate-pulse" /> Loading runtime map...
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-white/5 bg-[#0d0d10] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Server className="h-4 w-4 text-blue-300" />
              <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Runtime Health</h3>
            </div>
            <div className="space-y-2 text-xs">
              {(runtime?.components || []).slice(0, 12).map(component => (
                <div key={component.id} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.03] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-zinc-300">{component.name}</div>
                    <div className="text-[10px] text-zinc-600">{component.type}</div>
                  </div>
                  <span className={classNames(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    component.status === 'active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                  )}>
                    {component.status}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/5 bg-[#0d0d10] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-300" />
              <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Lifecycle</h3>
            </div>
            <div className="space-y-2">
              {lifecycle.length === 0 ? (
                <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-4 text-xs text-zinc-500">
                  Expertise load events will appear here.
                </div>
              ) : lifecycle.map((item, index) => (
                <div key={`${item.timestamp}-${index}`} className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div className="text-xs text-zinc-300">{item.message || item.event}</div>
                  <div className="mt-1 text-[10px] text-zinc-600">{item.expertise?.name || item.expertise?.id || item.event}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
