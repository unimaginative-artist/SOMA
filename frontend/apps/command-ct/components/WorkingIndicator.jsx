import React, { useState, useEffect } from 'react';

export const WorkingIndicator = ({ task = 'working', startTime }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = startTime || Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="flex items-center space-x-3 py-2">
      {/* Morphing Shape Indicator */}
      <div className="relative w-4 h-4">
        <div className="morph-shape"></div>
      </div>

      {/* Task Description */}
      <span className="text-cycle-work font-medium text-sm">{task}</span>

      {/* Timer */}
      <span className="text-zinc-500 text-xs font-mono tabular-nums">
        {formatTime(elapsed)}
      </span>

      <style>{`
        @keyframes morph {
          0% {
            border-radius: 50%;
            background-color: #a78bfa;
            transform: rotate(0deg) scale(1);
          }
          25% {
            border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
            background-color: #22d3ee;
            transform: rotate(90deg) scale(1.1);
          }
          50% {
            border-radius: 70% 30% 30% 70% / 70% 70% 30% 30%;
            background-color: #f472b6;
            transform: rotate(180deg) scale(0.9);
          }
          75% {
            border-radius: 30% 70% 30% 70% / 70% 30% 70% 30%;
            background-color: #fbbf24;
            transform: rotate(270deg) scale(1.05);
          }
          100% {
            border-radius: 50%;
            background-color: #a78bfa;
            transform: rotate(360deg) scale(1);
          }
        }

        @keyframes textColorWork {
          0%, 100% { color: #a78bfa; }
          33% { color: #22d3ee; }
          66% { color: #f472b6; }
        }

        .morph-shape {
          position: absolute;
          inset: 0;
          animation: morph 4s infinite ease-in-out;
          box-shadow: 0 0 10px currentColor;
        }

        .text-cycle-work {
          animation: textColorWork 4s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};
