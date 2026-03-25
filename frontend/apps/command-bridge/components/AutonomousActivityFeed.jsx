import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Target, CheckCircle, Clock, Brain, Code, Shield, Sparkles, XCircle } from 'lucide-react';

const typeConfig = {
  goal_active:        { icon: Target,      color: 'text-rose-400',    border: 'border-rose-500/20',  bg: 'bg-rose-500/5' },
  goal_completed:     { icon: CheckCircle,  color: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5' },
  rhythm_executed:    { icon: Clock,        color: 'text-cyan-400',    border: 'border-cyan-500/20',  bg: 'bg-cyan-500/5' },
  curiosity_explored: { icon: Sparkles,     color: 'text-amber-400',   border: 'border-amber-500/20', bg: 'bg-amber-500/5' },
  learning_session:   { icon: Brain,        color: 'text-violet-400',  border: 'border-violet-500/20', bg: 'bg-violet-500/5' },
  code_scanned:       { icon: Code,         color: 'text-blue-400',    border: 'border-blue-500/20',  bg: 'bg-blue-500/5' },
  approval_requested: { icon: Shield,       color: 'text-orange-400',  border: 'border-orange-500/20', bg: 'bg-orange-500/5' },
};
const defaultConfig = { icon: Activity, color: 'text-zinc-400', border: 'border-white/5', bg: 'bg-white/[0.02]' };

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const AutonomousActivityFeed = ({ isConnected }) => {
  const [feed, setFeed] = useState([]);
  const [expanded, setExpanded] = useState(null);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/recent?limit=50');
      if (res.ok) {
        const data = await res.json();
        if (data?.success && Array.isArray(data.feed)) setFeed(data.feed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    fetchFeed();
    let interval;
    const t = setTimeout(() => { interval = setInterval(fetchFeed, 15000); }, Math.random() * 5000);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [isConnected, fetchFeed]);

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
          <Activity className="w-4 h-4 mr-2 text-cyan-400" /> Activity Feed
        </h3>
        <span className="text-[9px] text-zinc-600 font-mono">{feed.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-1.5">
        {feed.length === 0 ? (
          <div className="text-center text-zinc-600 text-xs py-12">No activity recorded yet.</div>
        ) : (
          feed.map((ev, idx) => {
            const cfg = typeConfig[ev.type] || defaultConfig;
            const Icon = cfg.icon;
            const isExpanded = expanded === idx;

            return (
              <button
                key={`${ev.id || 'ev'}-${ev.timestamp || 'ts'}-${idx}`}
                onClick={() => setExpanded(isExpanded ? null : idx)}
                className={`w-full text-left ${cfg.bg} p-2.5 rounded-lg border ${cfg.border} hover:border-white/10 transition-all group`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-200 text-[11px] font-medium truncate">{ev.action}</span>
                      <span className="text-[9px] text-zinc-600 flex-shrink-0">{timeAgo(ev.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] ${cfg.color} uppercase tracking-widest`}>{ev.agent}</span>
                      {ev.status === 'failed' && <XCircle className="w-2.5 h-2.5 text-red-500" />}
                    </div>
                    {isExpanded && ev.detail && (
                      <div className="mt-1.5 text-[10px] text-zinc-400 leading-relaxed border-t border-white/5 pt-1.5">
                        {ev.detail}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AutonomousActivityFeed;
