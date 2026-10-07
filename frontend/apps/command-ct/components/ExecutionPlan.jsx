import React, { useState } from 'react';

const StatusBadge = ({ status }) => {
    const baseClasses = "text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border";
    let colorClasses = "bg-zinc-700/30 text-zinc-400 border-zinc-600";
    if (status.startsWith('Executing')) {
        colorClasses = "bg-blue-500/10 text-blue-300 border-blue-500/20 animate-pulse";
    } else if (status === 'Complete') {
        colorClasses = "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    } else if (status === 'Failed') {
        colorClasses = "bg-rose-500/10 text-rose-300 border-rose-500/20";
    } else if (status === 'Planning...') {
        colorClasses = "bg-amber-500/10 text-amber-300 border-amber-500/20 animate-pulse";
    }
    return <span className={`${baseClasses} ${colorClasses}`}>{status}</span>;
}

const LogEntry = ({ entry }) => {
    const typeStyles = {
        thought: 'text-zinc-400 italic',
        command: 'text-sky-300',
        output: 'text-zinc-300 whitespace-pre-wrap',
        error: 'text-rose-400',
        artifact: '',
    };
    
    const icon = {
        thought: <span className="mr-2 text-zinc-600 text-xs flex-shrink-0">●</span>,
        command: <span className="mr-2 text-sky-500/70 flex-shrink-0 font-mono">→</span>,
        output: <span className="mr-2 text-emerald-500/70 flex-shrink-0">✓</span>,
        error: <span className="mr-2 text-rose-500/70 flex-shrink-0">✕</span>,
        artifact: <span className="mr-2 text-amber-500/70 flex-shrink-0">📄</span>,
    }

    return (
      <div className={`font-mono text-xs py-1 flex items-start ${typeStyles[entry.type]}`}>
          {icon[entry.type]}
          <div className="min-w-0 leading-relaxed">{entry.content}</div>
      </div>
    );
}

export const AgentExecution = ({ goal, plan, logEntries, status }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    return (
        <div className="bg-zinc-800/50 backdrop-blur-md rounded-xl my-3 border border-white/5 shadow-lg w-full transition-all duration-300">
            <header 
                className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <div className="flex items-center space-x-3 min-w-0">
                     <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                     </div>
                    <div className="flex-grow min-w-0">
                        <h3 className="font-semibold text-sm text-zinc-200 truncate">Execution Plan</h3>
                        <p className="text-xs text-zinc-500 truncate">{goal}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-3 flex-shrink-0">
                    <StatusBadge status={status} />
                    <button className="text-zinc-500 hover:text-zinc-300 transition-colors">
                        {isCollapsed ? 
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg> :
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
                        }
                    </button>
                </div>
            </header>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0' : 'max-h-[500px]'}`}>
                <div className="p-4">
                    {plan && (
                        <div className="mb-4 bg-white/5 p-3 rounded-lg border border-white/5">
                            <h4 className="font-bold text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Strategy</h4>
                            <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{plan}</p>
                        </div>
                    )}
                    <div>
                        <h4 className="font-bold text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Log</h4>
                        <div className="max-h-64 overflow-y-auto pr-2 space-y-0.5 custom-scrollbar">
                            {logEntries.map((entry, index) => <LogEntry key={index} entry={entry} />)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
