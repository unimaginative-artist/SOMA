import React from 'react';
import { WorkflowStep, TaskStatus } from '../types';
import { CheckCircle2, Circle, Clock, Loader2, AlertTriangle, ArrowRight, Sparkles, ChevronRight } from 'lucide-react';

interface TaskMonitorProps {
  steps: WorkflowStep[];
  onSelectStep: (stepId: string) => void;
  selectedStepId?: string;
}

const TaskMonitor: React.FC<TaskMonitorProps> = ({ steps, onSelectStep, selectedStepId }) => {
  const getIcon = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.COMPLETED: return <CheckCircle2 className="w-4 h-4 text-[#34D399] drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]" />;
      case TaskStatus.IN_PROGRESS: return <Loader2 className="w-4 h-4 text-[#D8B4FE] animate-spin drop-shadow-[0_0_8px_rgba(216,180,254,0.6)]" />;
      case TaskStatus.FAILED: return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case TaskStatus.WAITING_ON_TOOL: return <Clock className="w-4 h-4 text-blue-400" />;
      default: return <Circle className="w-4 h-4 text-[#4C1D95]" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
       <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2 pb-2">
         {steps.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-full text-[#A78BFA] space-y-3 opacity-60">
             <div className="w-12 h-12 rounded-full bg-white/5 border border-white/5 flex items-center justify-center shadow-glow">
                <Sparkles className="w-6 h-6 text-[#D8B4FE]"/>
             </div>
             <span className="text-sm font-medium tracking-wide">Awaiting Neural Link...</span>
           </div>
         ) : (
           steps.map((step) => {
             const isSelected = selectedStepId === step.id;
             return (
               <div 
                  key={step.id}
                  onClick={() => onSelectStep(step.id)}
                  className={`
                    relative pl-4 py-3 pr-4 rounded-xl border flex items-center gap-3 group transition-all duration-200 cursor-pointer
                    ${isSelected 
                       ? 'bg-white/10 border-cyber-primary/40 shadow-glow' 
                       : step.status === TaskStatus.IN_PROGRESS 
                          ? 'bg-[#2E1065]/40 border-[#A855F7]/40 shadow-glow' 
                          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}
                  `}
               >
                  {/* Vertical Status Line */}
                  <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full transition-all duration-500 ${
                      step.status === TaskStatus.IN_PROGRESS ? 'bg-[#D8B4FE] shadow-[0_0_10px_#D8B4FE]' : 
                      step.status === TaskStatus.COMPLETED ? 'bg-[#34D399]' : 'bg-[#4C1D95]'
                  }`}></div>
  
                  <div className="shrink-0">{getIcon(step.status)}</div>
                  
                  <div className="flex-1 min-w-0">
                     <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium truncate tracking-tight ${step.status === TaskStatus.IN_PROGRESS ? 'text-[#FAF5FF] text-glow' : 'text-[#E9D5FF]'}`}>
                          {step.description}
                        </span>
                     </div>
                     <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-[#C4B5FD] opacity-70 font-mono tracking-wide">
                          {step.assignedArbiterRole}
                        </span>
                     </div>
                  </div>
                  
                  {step.status === TaskStatus.IN_PROGRESS && (
                      <span className="text-[10px] text-[#F0ABFC] font-semibold animate-pulse shrink-0">RUNNING</span>
                  )}
                  {isSelected && (
                     <ChevronRight className="w-4 h-4 text-cyber-primary animate-pulse" />
                  )}
               </div>
             );
           })
         )}
       </div>
    </div>
  );
};

export default TaskMonitor;