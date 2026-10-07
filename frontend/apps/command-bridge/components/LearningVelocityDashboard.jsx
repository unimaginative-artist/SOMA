import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, TrendingUp, AlertTriangle } from 'lucide-react';

const LearningVelocityDashboard = ({ isConnected }) => {
  const [metrics, setMetrics] = useState({ velocity: 0, acceleration: 0, coherence: 0, learningRate: 0 });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!isConnected) return;

    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/velocity/status');
        if (res.ok) {
          const data = await res.json();
          // Ensure data is a valid object before setting
          if (data && typeof data === 'object') {
            setMetrics({
                velocity: Number(data.velocity) || 0,
                acceleration: Number(data.acceleration) || 0,
                coherence: Number(data.coherence) || 0,
                learningRate: Number(data.learningRate) || 0
            });
            setHistory(prev => [...prev, { time: Date.now(), velocity: data.velocity }].slice(-20));
          }
        }
      } catch (e) {
          // Ignore errors
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Ultra-safe display values
  const velocityVal = metrics?.velocity || 0;
  const accelerationVal = metrics?.acceleration || 0;
  const learningRateVal = metrics?.learningRate || 0;

  const displayVelocity = velocityVal.toFixed(2);
  const displayAcceleration = accelerationVal.toFixed(2);
  const displayLearningRate = learningRateVal.toFixed(3);

  const isHighVelocity = velocityVal > 1.5;
  const isPositiveAccel = accelerationVal >= 0;

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg flex flex-col justify-between h-[200px]">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
            <Activity className="w-4 h-4 mr-2 text-blue-400" /> Learning Velocity
          </h3>
          <div className="flex items-baseline mt-2 space-x-2">
            <span className="text-3xl font-bold text-white font-mono">{displayVelocity}x</span>
            <span className={`text-xs font-medium ${isPositiveAccel ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isPositiveAccel ? '+' : ''}{displayAcceleration}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">
            Learning Rate: <span className="text-blue-400 font-mono">{displayLearningRate}</span>/s
          </div>
        </div>
        <div className={`p-2 rounded-lg ${isHighVelocity ? 'bg-emerald-500/10' : 'bg-zinc-800'}`}>
          <TrendingUp className={`w-5 h-5 ${isHighVelocity ? 'text-emerald-400' : 'text-zinc-500'}`} />
        </div>
      </div>

      <div className="h-16 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorVel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="velocity" stroke="#3b82f6" strokeWidth={2} fill="url(#colorVel)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LearningVelocityDashboard;
