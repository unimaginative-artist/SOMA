import React from 'react';
import { WorkflowPlan, TaskStatus } from '../types';
import { FileText, CheckCircle2, Clock, Layers } from 'lucide-react';

interface PlanOverviewProps {
  plan: WorkflowPlan | null;
}

const PlanOverview: React.FC<PlanOverviewProps> = ({ plan }) => {
  if (!plan) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-cyber-muted opacity-50">
        <Layers className="w-16 h-16 mb-4 opacity-50" />
        <h3 className="text-lg font-bold tracking-widest uppercase">No Active Operation</h3>
        <p className="text-sm font-mono mt-2">Initialize a task via Command Core to generate a plan.</p>
      </div>
    );
  }

  const completedSteps = plan.steps.filter(s => s.status === TaskStatus.COMPLETED);
  const artifacts = completedSteps.filter(s => s.output);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6 space-y-8">
      {/* Header Section */}
      <div className="glass-panel rounded-2xl p-6 border border-white/10 relative overflow-hidden group">
        <div className="absolute -top-10 -right-10 p-4 opacity-5 group-hover:opacity-10 transition-opacity duration-700">
          <FileText className="w-64 h-64 text-cyber-primary" />
        </div>
        <div className="relative z-10">
           <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2">
               <span className="w-2 h-2 rounded-full bg-cyber-primary animate-pulse"></span>
               <h5 className="text-[10px] font-bold text-cyber-primary uppercase tracking-[0.2em]">Operation Directive</h5>
             </div>
             {(plan as any).createdBy && (
               <div className="flex items-center gap-2 bg-gradient-to-r from-purple-500/10 to-fuchsia-500/10 px-3 py-1.5 rounded-full border border-purple-500/20">
                 <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></div>
                 <span className="text-[9px] font-bold text-purple-300 uppercase tracking-wider">Planned by: {(plan as any).createdBy}</span>
                 {(plan as any).plannerMetadata?.availableArbiters && (
                   <span className="text-[8px] text-purple-400/60 font-mono ml-1">({(plan as any).plannerMetadata.availableArbiters} arbiters)</span>
                 )}
               </div>
             )}
           </div>
           <h2 className="text-2xl font-bold text-white mb-4 leading-tight max-w-3xl">{plan.goal}</h2>
           <div className="bg-black/20 rounded-lg p-4 border-l-2 border-cyber-primary/50 backdrop-blur-sm">
             <p className="text-cyber-muted text-sm leading-relaxed max-w-4xl">
               {plan.summary}
             </p>
           </div>
        </div>
      </div>

      {/* Artifacts Grid */}
      <div>
        <h3 className="text-xs font-bold text-cyber-white uppercase tracking-[0.15em] mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
           <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Generated Artifacts
        </h3>
        
        {artifacts.length === 0 ? (
           <div className="border border-dashed border-white/10 rounded-xl p-8 flex flex-col items-center justify-center text-cyber-muted/40 bg-white/[0.02]">
              <Clock className="w-8 h-8 mb-3 animate-pulse" />
              <span className="font-mono text-xs uppercase tracking-wider">Awaiting agent outputs...</span>
           </div>
        ) : (
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {artifacts.map(step => (
                 <div key={step.id} className="glass-panel rounded-xl p-5 border border-white/5 hover:border-cyber-primary/30 transition-all group flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                       <span className="text-[9px] font-mono text-cyber-primary bg-cyber-primary/10 px-2 py-0.5 rounded border border-cyber-primary/10">
                          {step.assignedArbiterRole}
                       </span>
                       <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-bold bg-emerald-400/5 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED
                       </span>
                    </div>
                    <h4 className="text-sm font-bold text-white mb-3">{step.description}</h4>
                    <div className="flex-1 bg-black/40 rounded-lg p-3 text-xs font-mono text-cyber-white/80 whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar border border-white/5 shadow-inner">
                       {step.output}
                    </div>
                 </div>
              ))}
           </div>
        )}
      </div>

      {/* Plan Manifest */}
      <div className="pb-10">
         <h3 className="text-xs font-bold text-cyber-white uppercase tracking-[0.15em] mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
           <Layers className="w-4 h-4 text-cyber-accent" /> Execution Manifest
        </h3>
        <div className="space-y-0 relative pl-2">
            <div className="absolute left-[27px] top-4 bottom-4 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"></div>
            {plan.steps.map((step, idx) => (
                <div key={step.id} className="relative flex items-center gap-4 py-2 group">
                    <div className={`
                        w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 z-10 bg-[#090410] transition-all duration-300
                        ${step.status === TaskStatus.COMPLETED ? 'border-emerald-500/30 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : 
                          step.status === TaskStatus.IN_PROGRESS ? 'border-cyber-primary/50 text-cyber-primary animate-pulse shadow-[0_0_15px_rgba(216,180,254,0.2)]' : 
                          'border-white/10 text-cyber-muted/50'}
                    `}>
                        <span className="text-xs font-bold font-mono">{idx + 1}</span>
                    </div>
                    <div className="flex-1 glass-panel rounded-lg p-3 border border-white/5 flex items-center justify-between group-hover:bg-white/5 transition-colors">
                        <div>
                            <div className="text-xs font-bold text-white">{step.description}</div>
                            <div className="text-[10px] text-cyber-muted font-mono mt-1 opacity-60">{step.assignedArbiterRole}</div>
                        </div>
                        <StatusBadge status={step.status} />
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: TaskStatus }) => {
    switch(status) {
        case TaskStatus.COMPLETED: return <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/5 px-2 py-1 rounded border border-emerald-400/20 tracking-wider">COMPLETE</span>;
        case TaskStatus.IN_PROGRESS: return <span className="text-[9px] font-bold text-cyber-primary bg-cyber-primary/5 px-2 py-1 rounded border border-cyber-primary/20 animate-pulse tracking-wider">ACTIVE</span>;
        case TaskStatus.FAILED: return <span className="text-[9px] font-bold text-red-400 bg-red-400/5 px-2 py-1 rounded border border-red-400/20 tracking-wider">FAILED</span>;
        default: return <span className="text-[9px] font-bold text-cyber-muted/30 px-2 py-1 tracking-wider">PENDING</span>;
    }
}

export default PlanOverview;