import React from 'react';

export const CrawlReport = ({ startUrl, results }) => {
    const successCount = results.filter(r => r.status === 'Success').length;
    const failedCount = results.length - successCount;

    return (
        <div className="bg-zinc-800/50 backdrop-blur-md rounded-xl my-3 border border-white/5 shadow-lg w-full">
            <header className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/5">
                <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                    </div>
                    <div className="flex-grow min-w-0">
                        <h3 className="font-semibold text-sm text-zinc-200">Crawl Report</h3>
                        <p className="text-xs text-zinc-500 truncate">{startUrl}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-3 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-emerald-400">{successCount} OK</span>
                    <span className="text-rose-400">{failedCount} Err</span>
                </div>
            </header>
            <div className="p-4 text-xs font-mono">
                <ul className="space-y-1.5">
                    {results.map((result, index) => (
                        <li key={index} className="flex items-start">
                            <span className={`mr-2 flex-shrink-0 ${result.status === 'Success' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {result.status === 'Success' ? '✓' : '✕'}
                            </span>
                            <span className="truncate text-zinc-400">{result.url}</span>
                        </li>
                    ))}
                </ul>
                {results.length > 0 && <p className="mt-3 pt-2 border-t border-white/5 text-zinc-500 text-[10px] text-right">Mesh Updated</p>}
            </div>
        </div>
    );
};
