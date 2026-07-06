import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { WidgetData } from '../../types';
import { MessageCircle, Radio, Sparkles, Image as ImageIcon } from 'lucide-react';

interface Props {
  data: WidgetData;
}

const SocialActivityWidget: React.FC<Props> = ({ data }) => {
  const [cockpit, setCockpit] = useState<any>(null);
  const [memory, setMemory] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/social/cockpit').then(r => r.ok ? r.json() : Promise.reject(new Error('cockpit offline'))),
      fetch('/api/social/memory').then(r => r.ok ? r.json() : Promise.resolve(null)),
    ])
      .then(([cockpitData, memoryData]) => {
        if (cancelled) return;
        setCockpit(cockpitData);
        setMemory(memoryData);
        setStatus('live');
      })
      .catch(() => {
        if (!cancelled) setStatus('offline');
      });
    return () => { cancelled = true; };
  }, []);

  const activity = useMemo(() => {
    const queueItems = cockpit?.queue?.items || [];
    const interactions = cockpit?.engagement?.interactions || [];
    const memoryItems = memory?.events || memory?.recent || memory?.images || [];
    return [
      ...queueItems.slice(0, 4).map((item: any) => ({
        id: item.id || item.createdAt,
        type: item.postedAt ? 'posted' : item.failed ? 'failed' : 'queued',
        title: item.platform || 'social',
        text: item.text || item.summary || 'Queued social post',
        time: item.postedAt || item.createdAt || item.scheduledFor,
      })),
      ...interactions.slice(0, 3).map((item: any, index: number) => ({
        id: item.id || `interaction-${index}`,
        type: item.type || 'interaction',
        title: item.platform || 'engagement',
        text: item.text || item.reason || item.summary || 'Social interaction recorded',
        time: item.createdAt || item.timestamp,
      })),
      ...memoryItems.slice(0, 2).map((item: any, index: number) => ({
        id: item.id || `memory-${index}`,
        type: 'memory',
        title: 'memory',
        text: item.summary || item.title || item.filename || 'Social memory updated',
        time: item.createdAt || item.updatedAt,
      })),
    ].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 20);
  }, [cockpit, memory]);

  const platforms = cockpit?.platforms || {};
  const queue = cockpit?.queue || {};
  const openSocial = () => {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'stage', context: { section: 'stage-social' } } }));
  };
  const openAxis = () => {
    window.dispatchEvent(new CustomEvent('commandbridge:navigate', { detail: { module: 'axis' } }));
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'chats' } }));
  };
  const queueQuickPost = async () => {
    const text = window.prompt('Queue a quick SOMA social post');
    if (!text?.trim()) return;
    try {
      await fetch('/api/social/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'bluesky', text: text.trim(), type: 'studio_quick_post' }),
      });
      setStatus('loading');
      const data = await fetch('/api/social/cockpit').then(r => r.json());
      setCockpit(data);
      setStatus('live');
    } catch {
      setStatus('offline');
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#080808] p-5">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-cyan-200">
            <Radio size={17} />
            <h3 className="text-sm font-bold uppercase tracking-widest">SOMA Social</h3>
          </div>
          <p className="mt-1 text-[11px] text-white/35">
            {status === 'live' ? 'Autonomous activity feed' : status === 'loading' ? 'Syncing social state' : 'Social backend offline'}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${status === 'live' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/5 text-white/40'}`}>
          {status}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="text-lg font-bold text-white">{queue.pending || 0}</div>
          <div className="text-[9px] uppercase tracking-widest text-white/35">Pending</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="text-lg font-bold text-white">{queue.posted || 0}</div>
          <div className="text-[9px] uppercase tracking-widest text-white/35">Posted</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-1 text-lg font-bold text-white">
            <ImageIcon size={14} /> {platforms.bluesky?.canPostImages ? 'On' : 'Off'}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/35">Images</div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button onClick={openSocial} className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1.5 text-[10px] font-bold uppercase text-cyan-100 hover:bg-cyan-400/20">
          Stage
        </button>
        <button onClick={queueQuickPost} className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-bold uppercase text-emerald-100 hover:bg-emerald-400/20">
          Queue
        </button>
        <button onClick={openAxis} className="rounded-lg border border-purple-400/20 bg-purple-400/10 px-2 py-1.5 text-[10px] font-bold uppercase text-purple-100 hover:bg-purple-400/20">
          Axis
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
        {activity.length ? activity.map((item: any) => (
          <div key={item.id} className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200">
                <Sparkles size={11} /> {item.type}
              </span>
              <span className="text-[9px] text-white/25">{item.title}</span>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-white/65">{item.text}</p>
          </div>
        )) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-4 text-center text-xs text-white/35">
            No recent social activity found yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialActivityWidget;
