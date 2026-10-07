import React from 'react';

const SomaStatusStrip = ({
  activeGoal,
  goalProgress,
  tensionLevel,
  lastToolUsed,
  isSomaBusy,
  isConnected,
  sidebarCollapsed
}) => {
  const tension = tensionLevel || 0;
  const isUrgent = tension >= 70;
  const heartbeatColor = isConnected ? (isSomaBusy ? 'bg-fuchsia-400' : 'bg-emerald-500') : 'bg-red-500';
  const connectionStatusText = isConnected ? (isSomaBusy ? 'Thinking' : 'Active') : 'Offline';

  let tickerParts = [`${activeGoal || 'No Active Goal'}`];
  if (goalProgress !== undefined) tickerParts.push(`(${goalProgress.toFixed(0)}%)`);
  if (!sidebarCollapsed && lastToolUsed) tickerParts.push(`[${lastToolUsed}]`);
  tickerParts.push(`[${connectionStatusText}]`);
  const fullTickerText = tickerParts.join(' • ');

  // Tension bar color
  const tensionBarColor = isUrgent ? 'bg-rose-500' : tension >= 40 ? 'bg-fuchsia-500' : 'bg-emerald-500';

  return (
    <div className="bg-[#09090b]/95 backdrop-blur-xl border-t border-white/10 text-zinc-400 text-xs flex flex-col w-full overflow-hidden shrink-0">
      {/* Tension bar */}
      <div className="w-full h-1 bg-white/5">
        <div
          className={`h-full transition-all duration-1000 ${tensionBarColor} ${isUrgent ? 'animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]' : ''}`}
          style={{ width: `${Math.min(tension, 100)}%` }}
        />
      </div>

      <div className="py-2 px-3 flex items-center whitespace-nowrap min-h-[28px]">
        {/* Heartbeat dot */}
        <span className="relative flex h-2 w-2 mr-2 flex-shrink-0">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${heartbeatColor} opacity-75 ${isSomaBusy ? 'duration-700' : 'duration-1000'}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${heartbeatColor}`} />
        </span>

        {/* Scrolling ticker */}
        <div className="relative flex-1 overflow-hidden h-5 flex items-center">
          <span className="absolute whitespace-nowrap animate-marquee font-bold text-zinc-100 text-[10px] tracking-tight">
            {fullTickerText}
          </span>
        </div>

        {/* Tension readout */}
        <div className={`ml-2 flex-shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/5 ${isUrgent ? 'text-rose-400 border-rose-500/20' : 'text-zinc-500'}`}>
          {tension.toFixed(0)}%
        </div>
      </div>
    </div>
  );
};

export default SomaStatusStrip;
