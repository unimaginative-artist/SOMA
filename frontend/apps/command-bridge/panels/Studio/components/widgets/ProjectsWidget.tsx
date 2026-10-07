import * as React from 'react';
import { WidgetData } from '../../types';
import { FolderGit2, ArrowUpRight, Circle, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
    data: WidgetData;
}

const PROJECTS = [
    { id: 1, name: 'SOMA_ENGINE', status: 'deploying', progress: 85, type: 'System' },
    { id: 2, name: 'VoidUI Kit', status: 'active', progress: 40, type: 'Design' },
    { id: 3, name: 'Neural_Sync', status: 'concept', progress: 10, type: 'AI Research' },
];

const ProjectsWidget: React.FC<Props> = ({ data }) => {
  const getStatusColor = (status: string) => {
      switch(status) {
          case 'deploying': return 'text-emerald-400';
          case 'active': return 'text-blue-400';
          case 'concept': return 'text-purple-400';
          default: return 'text-white/50';
      }
  };

  const getStatusIcon = (status: string) => {
      switch(status) {
          case 'deploying': return <ArrowUpRight size={14} />;
          case 'active': return <Clock size={14} />;
          case 'concept': return <Circle size={14} />;
          default: return <AlertCircle size={14} />;
      }
  };

  return (
    <div className="w-full h-full flex flex-col p-6 bg-white/5 relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-2 text-white/80">
                <FolderGit2 size={18} />
                <span className="text-xs font-mono uppercase tracking-widest">Active Missions</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
        </div>

        {/* List */}
        <div className="flex-1 flex flex-col gap-3 relative z-10">
            {PROJECTS.map((project, i) => (
                <div key={project.id} className="group flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-md bg-black/40 ${getStatusColor(project.status)}`}>
                            {getStatusIcon(project.status)}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold font-display text-white group-hover:text-emerald-300 transition-colors">{project.name}</h3>
                            <span className="text-[10px] uppercase tracking-wider text-white/40">{project.type}</span>
                        </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs font-mono text-white/60">{project.progress}%</span>
                        <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full ${getStatusColor(project.status).replace('text-', 'bg-')}`} style={{ width: `${project.progress}%` }}></div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
        
        {/* Decorative background */}
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
    </div>
  );
};

export default ProjectsWidget;