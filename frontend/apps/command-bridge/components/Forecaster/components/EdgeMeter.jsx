import React from 'react';

const EdgeMeter = ({ edge, confidence }) => {
    // Edge ranges from -0.1 (bad value) to 0.1+ (great value)
    const percent = edge * 100;
    const isPositive = percent > 0;

    // Color scale
    let colorClass = "text-slate-400";
    if (percent > 5) colorClass = "text-emerald-400";
    else if (percent > 0) colorClass = "text-teal-400";
    else if (percent < -5) colorClass = "text-rose-500";
    else colorClass = "text-slate-300";

    return (
        <div className="flex flex-col gap-1">
            <div className="flex justify-between items-end">
                <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Alpha Edge</span>
                <span className={`text-xl font-mono font-bold ${colorClass}`}>
                    {isPositive ? '+' : ''}{percent.toFixed(1)}%
                </span>
            </div>

            {/* Bar visualizer */}
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex">
                <div className="w-1/2 flex justify-end">
                    {!isPositive && (
                        <div
                            className="h-full bg-rose-500 rounded-l-full"
                            style={{ width: `${Math.min(Math.abs(percent) * 5, 100)}%` }}
                        />
                    )}
                </div>
                <div className="w-1/2 flex justify-start border-l border-slate-700">
                    {isPositive && (
                        <div
                            className="h-full bg-emerald-400 rounded-r-full shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                            style={{ width: `${Math.min(percent * 5, 100)}%` }}
                        />
                    )}
                </div>
            </div>

            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>Overpriced</span>
                <span>Neutral</span>
                <span>Undervalued</span>
            </div>
        </div>
    );
};

export default EdgeMeter;
