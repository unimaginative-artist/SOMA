import React, { useState, useEffect } from 'react';
import { Eye, Activity, Maximize2, Radio, Camera, Monitor, HardDrive } from 'lucide-react';

const getFrameUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http') || path.startsWith('/') || path.startsWith('data:')) return path;
  return `/api/perception/vision/frame?path=${encodeURIComponent(path)}`;
};

const MindsEye = ({ isConnected }) => {
  const [vision, setVision] = useState(null);
  const [health, setHealth] = useState(null);
  const [showExplore, setShowExplore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    const fetchPerception = async () => {
      try {
        const [visionRes, healthRes] = await Promise.allSettled([
          fetch('/api/perception/vision/last').then(res => res.ok ? res.json() : null),
          fetch('/api/perception/health').then(res => res.ok ? res.json() : null)
        ]);
        if (!active) return;
        if (visionRes.status === 'fulfilled' && visionRes.value?.success) setVision(visionRes.value);
        if (healthRes.status === 'fulfilled' && healthRes.value?.success) setHealth(healthRes.value);
        setError(null);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    fetchPerception();
    const interval = setInterval(fetchPerception, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isConnected]);

  const lastPerception = vision?.lastPerception || health?.vision?.lastPerception || null;
  const imagePath = vision?.imagePath || lastPerception?.imagePath || null;
  const channel = vision?.channel || health?.vision?.channel || 'desktop';
  const activeVision = health?.vision?.active === true;
  const attention = health?.attention?.focus || 'No attention target';
  const signalCount = health?.signals?.recentCount ?? 0;
  const scenes = health?.vision?.sceneMemory?.count ?? vision?.sceneMemory?.count ?? 0;
  const retention = health?.vision?.retention || null;
  const ChannelIcon = channel === 'webcam' ? Camera : Monitor;

  return (
    <>
      <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-[300px] flex flex-col hover:border-fuchsia-500/20 transition-all duration-500">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
            <Eye className="w-4 h-4 mr-2 text-fuchsia-400" /> Visual Perception
          </h3>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest">
            <span className={activeVision ? 'text-emerald-400' : 'text-zinc-500'}>{activeVision ? 'active' : 'idle'}</span>
            <ChannelIcon className="w-3 h-3" />
            <span>{channel}</span>
          </div>
        </div>

        {error && <div className="text-xs text-red-400 mb-3">{error}</div>}

        <div className="flex-1 flex gap-4 min-h-0">
          <div className="w-1/2 rounded-lg bg-black/40 border border-white/5 overflow-hidden relative">
            {imagePath ? (
              <img src={getFrameUrl(imagePath)} alt="Latest perception frame" className="w-full h-full object-cover opacity-80" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 space-y-2">
                <Activity className="w-8 h-8 opacity-20" />
                <span className="text-[10px] uppercase font-bold tracking-wider">No captured frame</span>
              </div>
            )}
            <div className="absolute top-2 left-2 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-bold text-zinc-400 border border-white/10 uppercase">
              Latest Frame
            </div>
          </div>

          <div className="w-1/2 flex flex-col justify-between min-w-0">
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                <p className="text-[9px] text-fuchsia-400 font-bold uppercase tracking-widest mb-1">Attention Focus</p>
                <p className="text-sm text-zinc-200 font-medium truncate">{attention}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <p className="text-[9px] text-cyan-400 uppercase tracking-widest">Signals</p>
                  <p className="text-sm text-zinc-200 font-mono">{signalCount}</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <p className="text-[9px] text-cyan-400 uppercase tracking-widest">Scenes</p>
                  <p className="text-sm text-zinc-200 font-mono">{scenes}</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowExplore(true)}
              className="self-end text-[10px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest flex items-center transition-colors"
            >
              Inspect <Maximize2 className="w-3 h-3 ml-1" />
            </button>
          </div>
        </div>
      </div>

      {showExplore && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-3xl bg-[#0b0b0e] border border-white/10 rounded-2xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-zinc-300 uppercase tracking-widest font-bold">Perception Status</div>
              <button onClick={() => setShowExplore(false)} className="text-zinc-500 hover:text-white text-xs">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/40 border border-white/5 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 flex items-center"><Radio className="w-3 h-3 mr-1" /> Attention</span>
                  <span className="text-zinc-200 truncate ml-3">{attention}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 flex items-center"><ChannelIcon className="w-3 h-3 mr-1" /> Channel</span>
                  <span className="text-zinc-200">{channel}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 flex items-center"><HardDrive className="w-3 h-3 mr-1" /> Cached Frames</span>
                  <span className="text-zinc-200">{retention?.fileCount ?? 0} / {retention?.totalMb ?? 0}MB</span>
                </div>
              </div>
              <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                {imagePath ? (
                  <img src={getFrameUrl(imagePath)} alt="Latest perception frame" className="w-full h-40 object-cover rounded-md opacity-90" />
                ) : (
                  <div className="text-xs text-zinc-600 italic">No visual frame captured.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MindsEye;
