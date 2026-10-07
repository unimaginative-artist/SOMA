import React, { useEffect, useRef, useState } from 'react';
import { BRAINS } from '../constants';
import { TraceLog, BrainType } from '../types';
import { Play, Pause, Rewind, Activity } from 'lucide-react';

interface CognitiveTraceProps {
  filterBrain: BrainType | null;
  externalLog: TraceLog | null;
}

export const CognitiveTrace: React.FC<CognitiveTraceProps> = ({ filterBrain, externalLog }) => {
  const [logs, setLogs] = useState<TraceLog[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Handle external logs (from global actions)
  useEffect(() => {
    if (externalLog) {
      setLogs(prev => [...prev.slice(-40), externalLog]);
    }
  }, [externalLog]);

  // Generate random logs
  useEffect(() => {
    const actions = [
      'proposed a hypothesis',
      'rejected a contradiction',
      'updated a threat model',
      'weakened a belief',
      'reinforced a pattern',
      'scanned memory bank',
      'detected anomaly',
      'initiated heuristic link'
    ];

    const generateLog = () => {
      if (isPaused) return;
      
      const brains = Object.values(BrainType);
      const randomBrain = brains[Math.floor(Math.random() * brains.length)];
      const randomAction = actions[Math.floor(Math.random() * actions.length)];
      
      const newLog: TraceLog = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        brain: randomBrain,
        action: randomAction,
        confidenceShift: Math.random() > 0.5 ? 0.05 : -0.02
      };

      setLogs(prev => [...prev.slice(-30), newLog]);
    };

    const interval = setInterval(generateLog, 2500); // Slowed down automated logs to let user actions shine
    return () => clearInterval(interval);
  }, [isPaused]);

  // Auto scroll
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-48 bg-slate-950/90 border-t border-slate-800 z-30 flex flex-col backdrop-blur-md">
      {/* Trace Header / Controls */}
      <div className="h-10 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50">
        <div className="flex items-center space-x-2 text-slate-400 text-xs uppercase tracking-widest font-semibold">
           <Activity size={14} />
           <span>Cognitive Trace Viewer</span>
        </div>
        <div className="flex items-center space-x-2">
           <button onClick={() => setIsPaused(!isPaused)} className="p-1 hover:text-white text-slate-400">
             {isPaused ? <Play size={14} /> : <Pause size={14} />}
           </button>
           <button className="p-1 hover:text-white text-slate-400">
             <Rewind size={14} />
           </button>
        </div>
      </div>

      {/* Logs Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm relative mask-linear-fade">
         {logs.filter(l => !filterBrain || l.brain === filterBrain).map((log) => {
            const brainConfig = BRAINS[log.brain];
            return (
                <div key={log.id} className="flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <span className="text-slate-600 text-xs w-20">{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}</span>
                    <span className="text-xs font-bold uppercase w-24" style={{ color: brainConfig.color }}>
                        {brainConfig.name}
                    </span>
                    <span className="text-slate-300 flex-1">{log.action}</span>
                    <span className={`text-xs ${log.confidenceShift && log.confidenceShift > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {log.confidenceShift && log.confidenceShift > 0 ? '+' : ''}
                        {(log.confidenceShift! * 100).toFixed(0)}%
                    </span>
                </div>
            )
         })}
         <div ref={bottomRef} />
      </div>
      
      {/* Decorative gradient overlay for scroll */}
      <div className="absolute top-10 left-0 right-0 h-8 bg-gradient-to-b from-slate-950/90 to-transparent pointer-events-none"></div>
    </div>
  );
};
