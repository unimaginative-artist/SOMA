import React, { useEffect, useRef } from 'react';
import { WorkflowStep, TaskStatus } from '../types';
import { Terminal, Clock, CheckCircle2, AlertTriangle, FileText, Code, X, Wrench, Cpu, Zap } from 'lucide-react';

interface TaskDetailPanelProps {
  step: WorkflowStep | undefined;
  onClose: () => void;
}

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({ step, onClose }) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [step?.logs]);

  if (!step) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-cyber-muted opacity-50 space-y-2">
        <Terminal className="w-12 h-12" />
        <p className="text-sm font-mono">Select a task to inspect execution traces.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
       {/* Header */}
       <div className="flex items-start justify-between pb-4 border-b border-white/5 shrink-0">
          <div>
            <h3 className="text-md font-bold text-cyber-white leading-tight">{step.description}</h3>
            <div className="flex items-center gap-2 mt-1">
               <span className="text-[10px] font-mono text-cyber-primary bg-cyber-primary/10 px-2 py-0.5 rounded border border-cyber-primary/20">
                 {step.id}
               </span>
               <span className="text-[10px] text-cyber-muted">
                  {step.assignedArbiterRole}
               </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg text-cyber-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
       </div>

       {/* Stats Grid */}
       <div className={`grid ${step.toolsUsed && step.toolsUsed.length > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 py-4 shrink-0`}>
          <div className="bg-black/20 rounded-lg p-3 border border-white/5">
             <div className="flex items-center gap-2 text-cyber-muted text-xs mb-1">
                <Clock className="w-3 h-3" /> Duration
             </div>
             <div className="text-sm font-mono text-cyber-white">
                {step.startTime ? (
                   step.endTime 
                    ? `${((step.endTime - step.startTime) / 1000).toFixed(2)}s` 
                    : `${((Date.now() - step.startTime) / 1000).toFixed(0)}s (Running)`
                ) : '--'}
             </div>
          </div>
          <div className="bg-black/20 rounded-lg p-3 border border-white/5">
             <div className="flex items-center gap-2 text-cyber-muted text-xs mb-1">
                <ActivityIcon status={step.status} /> Status
             </div>
             <div className={`text-sm font-bold ${getStatusColor(step.status)}`}>
                {step.status}
             </div>
          </div>
          {step.toolsUsed && step.toolsUsed.length > 0 && (
            <div className="bg-amber-900/10 rounded-lg p-3 border border-amber-500/20">
               <div className="flex items-center gap-2 text-amber-400/80 text-xs mb-1">
                  <Wrench className="w-3 h-3" /> Tools
               </div>
               <div className="text-sm font-mono text-amber-300">
                  {step.toolsUsed.length} used
               </div>
            </div>
          )}
       </div>

       {/* Logs / Output Tabs (Simplified to vertical stack for now) */}
       <div className="flex-1 flex flex-col min-h-0 space-y-4 overflow-y-auto custom-scrollbar pr-2">
          
          {/* Tools Used Section */}
          {step.toolsUsed && step.toolsUsed.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-amber-400/80 uppercase tracking-wider flex items-center gap-2">
                <Wrench className="w-3 h-3" /> Tool Execution
              </h4>
              <div className="space-y-1.5">
                {step.toolsUsed.map((tool, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-mono ${
                    tool.success
                      ? 'bg-emerald-900/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-red-900/10 border-red-500/20 text-red-300'
                  }`}>
                    {tool.success
                      ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      : <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                    }
                    <span className="font-bold">{tool.name}</span>
                    {tool.brainPicked && (
                      <span className="ml-auto flex items-center gap-1 text-[9px] text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">
                        <Cpu className="w-2.5 h-2.5" /> Brain-picked
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Hints Section (orchestrator-suggested but not yet executed) */}
          {step.tools && step.tools.length > 0 && (!step.toolsUsed || step.toolsUsed.length === 0) && step.status !== 'COMPLETED' && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-cyber-muted uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-3 h-3 text-amber-400" /> Suggested Tools
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {step.tools.map((tool, i) => (
                  <span key={i} className="text-[10px] font-mono px-2 py-1 rounded bg-white/5 border border-white/10 text-cyber-muted">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Logs Section */}
          <div className="flex flex-col gap-2">
             <h4 className="text-xs font-bold text-cyber-muted uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-3 h-3" /> Arbiter Logs
             </h4>
             <div className="bg-[#090410] rounded-xl p-3 border border-white/10 font-mono text-[10px] leading-relaxed text-gray-300 shadow-inner h-48 overflow-y-auto custom-scrollbar">
                {step.logs.length === 0 ? (
                   <span className="opacity-30 italic">No execution logs yet...</span>
                ) : (
                   step.logs.map((log, i) => (
                      <div key={i} className="mb-1 border-b border-white/5 pb-1 last:border-0 last:pb-0">
                         <span className="text-cyber-primary opacity-60 mr-2">{'>'}</span>
                         {log}
                      </div>
                   ))
                )}
                <div ref={logEndRef} />
             </div>
          </div>

          {/* Output Section */}
          {step.output && (
             <div className="flex flex-col gap-2 pb-4">
                <h4 className="text-xs font-bold text-cyber-muted uppercase tracking-wider flex items-center gap-2">
                   <FileText className="w-3 h-3" /> Final Artifact
                </h4>
                <div className="bg-emerald-900/10 rounded-xl p-3 border border-emerald-500/20 text-xs text-emerald-100/90 whitespace-pre-wrap font-mono">
                   {step.output}
                </div>
             </div>
          )}
       </div>
    </div>
  );
};

const ActivityIcon = ({ status }: { status: TaskStatus }) => {
  if (status === TaskStatus.COMPLETED) return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
  if (status === TaskStatus.FAILED) return <AlertTriangle className="w-3 h-3 text-red-400" />;
  return <Clock className="w-3 h-3 text-cyber-primary" />;
};

const getStatusColor = (status: TaskStatus) => {
  if (status === TaskStatus.COMPLETED) return 'text-emerald-400';
  if (status === TaskStatus.FAILED) return 'text-red-400';
  if (status === TaskStatus.IN_PROGRESS) return 'text-cyber-primary';
  return 'text-cyber-muted';
}

export default TaskDetailPanel;