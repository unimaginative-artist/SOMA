import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, FileText, Clock, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import MarkdownIt from 'markdown-it';
import somaBackend from '../somaBackend.js';

const md = new MarkdownIt();

const STATUS_COLORS = {
  ok:    'text-emerald-400',
  error: 'text-red-400',
  idle:  'text-zinc-600',
};

const SomaPlanViewer = ({ isConnected }) => {
  const [content, setContent]       = useState('');
  const [updatedAt, setUpdatedAt]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [activities, setActivities] = useState([]);
  const [showLog, setShowLog]       = useState(false);

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/soma/plan');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setContent(data.plan || '');
        setUpdatedAt(data.updatedAt);
      } else {
        setContent(`*Failed to load plan: ${data.error || 'Unknown error'}.*`);
      }
    } catch (error) {
      console.error('Error fetching plan:', error);
      setContent(`*Failed to load plan: ${error.message}.*`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — REST endpoint works regardless of WebSocket state
  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  // Live plan updates from GoalPlannerArbiter
  useEffect(() => {
    const handler = (payload) => {
      if (payload.content) setContent(payload.content);
      if (payload.updatedAt) setUpdatedAt(payload.updatedAt);
    };
    somaBackend.on('plan_updated', handler);
    return () => somaBackend.off('plan_updated', handler);
  }, []);

  // Fix 5: live execution feed from AutonomousHeartbeat
  useEffect(() => {
    const handler = (payload) => {
      if (!payload?.source) return;
      setActivities(prev => [{
        source:      payload.source,
        description: payload.description || '',
        output:      payload.output || '',
        status:      payload.status || 'ok',
        durationMs:  payload.durationMs,
        ts:          Date.now(),
      }, ...prev].slice(0, 10));
    };
    somaBackend.on('soma_activity', handler);
    return () => somaBackend.off('soma_activity', handler);
  }, []);

  const timeAgo = updatedAt ? new Date(updatedAt).toLocaleTimeString() : null;

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-200">SOMA's Plan</span>
          {timeAgo && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-600">
              <Clock className="w-3 h-3" /> {timeAgo}
            </span>
          )}
        </div>
        <button
          onClick={fetchPlan}
          disabled={loading}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Rendered markdown */}
      <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
        {content ? (
          <div
            className="prose prose-invert prose-sm max-w-none
              prose-headings:text-zinc-100 prose-headings:font-bold
              prose-h1:text-lg prose-h2:text-base prose-h2:text-violet-300 prose-h2:border-b prose-h2:border-white/5 prose-h2:pb-1
              prose-p:text-zinc-400 prose-p:text-xs
              prose-li:text-zinc-300 prose-li:text-xs prose-li:my-0.5
              prose-strong:text-zinc-100
              prose-em:text-zinc-500
              prose-blockquote:border-violet-500/40 prose-blockquote:text-zinc-500 prose-blockquote:text-xs
              prose-hr:border-white/5
              prose-del:text-zinc-600 prose-del:opacity-60
            "
            dangerouslySetInnerHTML={{ __html: md.render(content) }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-700 text-xs">
            <FileText className="w-10 h-10 mb-3 opacity-20" />
            <p>No plan yet — SOMA will write one after her first planning cycle.</p>
          </div>
        )}
      </div>

      {/* Execution Activity Log */}
      <div className="flex-shrink-0 border-t border-white/5">
        <button
          onClick={() => setShowLog(v => !v)}
          className="flex items-center justify-between w-full px-5 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            Execution Log
            {activities.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 text-[9px] font-semibold">
                {activities.length}
              </span>
            )}
          </span>
          {showLog ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>

        {showLog && (
          <div className="max-h-48 overflow-y-auto px-5 pb-3 space-y-1.5 custom-scrollbar">
            {activities.length === 0 ? (
              <p className="text-[10px] text-zinc-700 py-2">No activity yet — heartbeat events will appear here.</p>
            ) : (
              activities.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px]">
                  <span className={`mt-0.5 font-semibold shrink-0 ${STATUS_COLORS[a.status] || 'text-zinc-400'}`}>
                    {a.status === 'ok' ? '✓' : a.status === 'error' ? '✗' : '·'}
                  </span>
                  <div className="min-w-0">
                    <span className="text-zinc-500 mr-1">[{a.source}]</span>
                    <span className="text-zinc-300">{(a.output || a.description).substring(0, 120)}</span>
                    {a.durationMs && (
                      <span className="ml-1 text-zinc-700">{(a.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SomaPlanViewer;
