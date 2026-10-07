
import React from 'react';
import { 
  AlertTriangle, 
  Lock, 
  Eraser, 
  Camera, 
  GitBranch, 
  Zap, 
  Waves 
} from 'lucide-react';

interface ControlBarProps {
  onAction: (action: string) => void;
  systemStatus: {
    label: string;
    color: string;
  };
}

export const ControlBar: React.FC<ControlBarProps> = ({ onAction, systemStatus }) => {
  const actions = [
    { icon: AlertTriangle, label: 'Expose Contradictions', id: 'expose', color: 'hover:text-red-400' },
    { icon: Lock, label: 'Commit Current State', id: 'commit', color: 'hover:text-blue-400' },
    { icon: Eraser, label: 'Prune Low-Energy', id: 'prune', color: 'hover:text-orange-400' },
    { icon: Camera, label: 'Mind Snapshot', id: 'snapshot', color: 'hover:text-white' },
    { icon: GitBranch, label: 'Fork Timeline', id: 'fork', color: 'hover:text-purple-400' },
    { icon: Zap, label: 'Inject Hypothesis', id: 'inject', color: 'hover:text-yellow-400' },
    { icon: Waves, label: 'Run Causal Simulation', id: 'causal', color: 'hover:text-cyan-400' },
  ];

  return (
    <div className="absolute top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between pointer-events-none">
      <div className="flex items-center space-x-2 pointer-events-auto">
         <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-lg p-1 flex items-center space-x-1">
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => onAction(action.id)}
                className={`group relative p-2 rounded-md hover:bg-slate-800 transition-all active:scale-95 text-slate-400 ${action.color}`}
              >
                <action.icon size={18} />
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 border border-slate-700 text-xs text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-xl">
                  {action.label}
                </span>
              </button>
            ))}
         </div>
      </div>
      
      <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded px-4 py-2 flex items-center space-x-4 pointer-events-auto">
         <div className="flex flex-col items-end">
             <span className="text-xs text-slate-400 uppercase tracking-widest display-font">System Integrity</span>
             <div className="flex items-center space-x-2">
                 <span className={`w-2 h-2 rounded-full animate-pulse ${systemStatus.color}`}></span>
                 <span className="text-sm font-bold text-white tracking-wide transition-all duration-300">{systemStatus.label}</span>
             </div>
         </div>
      </div>
    </div>
  );
};
