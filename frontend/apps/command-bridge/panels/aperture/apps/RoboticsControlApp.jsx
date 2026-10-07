import React, { useState, useEffect } from 'react';
import { Bot, Battery, Eye, Sliders, Shield, Zap, Move, Compass, Volume2, UserCheck, AlertTriangle, RefreshCw, Box } from 'lucide-react';

export default function RoboticsControlApp() {
  const [headPan, setHeadPan] = useState(0);
  const [headTilt, setHeadTilt] = useState(0);
  const [armElbow, setArmElbow] = useState(30);
  const [battery, setBattery] = useState(98.5);
  const [eStop, setEStop] = useState(false);
  const [viewMode, setViewMode] = useState('3d'); // '3d' | 'sensor' | 'telemetry'
  const [logs, setLogs] = useState([
    { text: '🤖 PhysicalEmbodimentEngine initialized (Unit 1, 3D WebGL Simulation Mode)', type: 'system', timestamp: '16:58:00' },
    { text: '👁️ Tracked Operator: Owner (Operator) at 1.2m front_center', type: 'sensor', timestamp: '16:58:02' }
  ]);

  const handleMoveHead = (joint, delta) => {
    if (eStop) return;
    if (joint === 'pan') {
      const newPan = Math.max(-90, Math.min(90, headPan + delta));
      setHeadPan(newPan);
      setLogs(prev => [...prev, { text: `🦾 Head Pan Servo turned to ${newPan}°`, type: 'motor', timestamp: new Date().toLocaleTimeString() }]);
    } else if (joint === 'tilt') {
      const newTilt = Math.max(-45, Math.min(45, headTilt + delta));
      setHeadTilt(newTilt);
      setLogs(prev => [...prev, { text: `🦾 Head Tilt Servo turned to ${newTilt}°`, type: 'motor', timestamp: new Date().toLocaleTimeString() }]);
    } else if (joint === 'elbow') {
      const newElbow = Math.max(0, Math.min(120, armElbow + delta));
      setArmElbow(newElbow);
      setLogs(prev => [...prev, { text: `🦾 Articulated Arm Elbow set to ${newElbow}°`, type: 'motor', timestamp: new Date().toLocaleTimeString() }]);
    }
  };

  const toggleEStop = () => {
    setEStop(!eStop);
    setLogs(prev => [...prev, { text: !eStop ? '🚨 EMERGENCY E-STOP ENGAGED!' : '✅ Emergency E-Stop Disengaged.', type: !eStop ? 'error' : 'system', timestamp: new Date().toLocaleTimeString() }]);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#050508] text-slate-100 font-sans overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-600 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Bot size={22} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              SOMA Embodiment & Robotics <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">3D Spatial Unit 1</span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">ROS2 / WebGL Spatial Arm Bridge & Depth Sensor Grid</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
            <Battery size={14} /> {battery}% Charged
          </div>
          <button
            onClick={toggleEStop}
            className={`px-4 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition-all ${
              eStop
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/40 animate-pulse'
                : 'bg-white/10 hover:bg-white/20 text-slate-300 border border-white/10'
            }`}
          >
            <AlertTriangle size={14} /> {eStop ? 'E-STOP ACTIVE' : 'Engage E-Stop'}
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 p-6 grid grid-cols-3 gap-6 overflow-hidden">
        {/* Left: Joint & Motor Controls */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
          <h2 className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider flex items-center gap-2">
            <Sliders size={14} /> Head & Arm Servo Actuators
          </h2>

          <div className="space-y-6 my-auto">
            {/* Pan */}
            <div>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="text-slate-400">Neck Pan Angle:</span>
                <span className="font-bold text-cyan-300">{headPan}°</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => handleMoveHead('pan', -15)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Left (-15°)</button>
                <div className="flex-1 bg-white/10 h-2 rounded-full overflow-hidden">
                  <div className="bg-cyan-500 h-full transition-all" style={{ width: `${((headPan + 90) / 180) * 100}%` }}></div>
                </div>
                <button onClick={() => handleMoveHead('pan', 15)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Right (+15°)</button>
              </div>
            </div>

            {/* Tilt */}
            <div>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="text-slate-400">Neck Tilt Angle:</span>
                <span className="font-bold text-purple-300">{headTilt}°</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => handleMoveHead('tilt', -10)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Down (-10°)</button>
                <div className="flex-1 bg-white/10 h-2 rounded-full overflow-hidden">
                  <div className="bg-purple-500 h-full transition-all" style={{ width: `${((headTilt + 45) / 90) * 100}%` }}></div>
                </div>
                <button onClick={() => handleMoveHead('tilt', 10)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Up (+10°)</button>
              </div>
            </div>

            {/* Elbow Articulation */}
            <div>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="text-slate-400">Articulated Arm Joint:</span>
                <span className="font-bold text-emerald-300">{armElbow}°</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => handleMoveHead('elbow', -15)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Contract (-15°)</button>
                <div className="flex-1 bg-white/10 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(armElbow / 120) * 100}%` }}></div>
                </div>
                <button onClick={() => handleMoveHead('elbow', 15)} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white">Extend (+15°)</button>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Safety Mode: <strong className="text-emerald-400">Disarmed (Sim)</strong></span>
            <span>Force Torque: <strong className="text-cyan-400">0.0 Nm</strong></span>
          </div>
        </div>

        {/* Center: Interactive 3D Spatial Wireframe Viewport */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between mb-4 z-10">
            <h2 className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider flex items-center gap-2">
              <Box size={14} /> 3D Spatial Wireframe HUD
            </h2>
            <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
              FPS: 60 | Render: Canvas 3D
            </span>
          </div>

          {/* Interactive SVG 3D Spatial Viewport */}
          <div className="flex-1 relative flex items-center justify-center bg-black/40 rounded-xl border border-cyan-500/20 overflow-hidden">
            {/* Grid Lines */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#0284c710_1px,transparent_1px),linear-gradient(to_bottom,#0284c710_1px,transparent_1px)] bg-[size:24px_24px]"></div>

            {/* 3D Spatial Arm Rendering */}
            <svg viewBox="0 0 400 300" className="w-full h-full relative z-10">
              {/* Base pedestal */}
              <ellipse cx="200" cy="250" rx="80" ry="25" fill="none" stroke="#0284c7" strokeWidth="2" strokeDasharray="4 4" />
              <rect x="180" y="210" width="40" height="40" fill="#0369a1" opacity="0.4" rx="4" />

              {/* Shoulder joint */}
              <circle cx="200" cy="210" r="14" fill="#38bdf8" />

              {/* Bicep Arm Segment (Rotated by headPan & armElbow) */}
              <g transform={`rotate(${headPan * 0.4}, 200, 210)`}>
                <line x1="200" y1="210" x2="200" y2="130" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" />
                
                {/* Elbow joint */}
                <circle cx="200" cy="130" r="10" fill="#a855f7" />

                {/* Forearm Segment */}
                <g transform={`rotate(${headTilt * 0.8 + armElbow * 0.5}, 200, 130)`}>
                  <line x1="200" y1="130" x2="260" y2="70" stroke="#a855f7" strokeWidth="4" strokeLinecap="round" />
                  
                  {/* End Effector Camera Sensor */}
                  <circle cx="260" cy="70" r="8" fill="#34d399" />
                  {/* Vision Cone */}
                  <polygon points="260,70 320,30 320,110" fill="url(#visionGrad)" opacity="0.4" />
                </g>
              </g>

              {/* Vision Cone Gradient */}
              <defs>
                <linearGradient id="visionGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Live Spatial Overlay Data */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[10px] text-cyan-300/80 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-cyan-500/30 z-20">
              <span>PAN: {headPan}° | TILT: {headTilt}°</span>
              <span>DEPTH SENSOR: 1.2m (CLEAR)</span>
            </div>
          </div>
        </div>

        {/* Right: Real-time Telemetry Logs */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
          <h2 className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider flex items-center gap-2 mb-4">
            <Eye size={14} /> Telemetry & Motor Event Stream
          </h2>

          <div className="flex-1 bg-black/50 border border-white/10 rounded-xl p-4 font-mono text-xs overflow-y-auto space-y-2 mb-4">
            {logs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-slate-500 text-[10px]">{log.timestamp}</span>
                <span className={log.type === 'error' ? 'text-red-400 font-bold' : log.type === 'motor' ? 'text-cyan-300' : 'text-slate-300'}>
                  {log.text}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="flex items-center gap-1.5"><UserCheck size={14} className="text-emerald-400" /> Operator Active</span>
            <button onClick={() => setLogs([])} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
              <RefreshCw size={12} /> Clear Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
