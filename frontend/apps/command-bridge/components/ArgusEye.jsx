import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Zap, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ArgusEye — PROJECT ARGUS
 * v0.1 — Live Visual Ingestion Component
 */
const ArgusEye = ({ isConnected }) => {
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [statusText, setStatusText] = useState('Camera idle');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const captureIntervalRef = useRef(null);

  const emitPerceptionEvent = (detail) => {
    window.dispatchEvent(new CustomEvent('soma:perception-event', { detail }));
  };

  const startVision = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480, frameRate: 15 } 
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      await fetch('/api/perception/vision/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'webcam' })
      }).catch(() => {});
      setIsVisionActive(true);
      setStatusText('Camera stream active');
      emitPerceptionEvent({ type: 'camera', title: 'Camera stream active', detail: 'Browser webcam connected to Presence.', status: 'ok' });
      
      captureIntervalRef.current = setInterval(captureFrame, 1500);
      console.log('👁️ [Argus] Vision stream active.');
    } catch (err) {
      console.error('👁️ [Argus] Could not access camera:', err);
      setStatusText('Camera unavailable');
      emitPerceptionEvent({ type: 'camera', title: 'Camera unavailable', detail: err.message || 'Browser denied or no camera found.', status: 'warn' });
    }
  };

  const stopVision = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    setIsVisionActive(false);
    setStatusText('Camera idle');
    emitPerceptionEvent({ type: 'camera', title: 'Camera stream paused', status: 'info' });
    console.log('👁️ [Argus] Vision stream paused.');
  };

  const captureFrame = async () => {
    if (!canvasRef.current || !videoRef.current || !isConnected) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to Base64 (JPEG for speed/compression)
    const frameData = canvas.toDataURL('image/jpeg', 0.5);

    try {
      const res = await fetch('/api/perception/vision/ingest-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          frameData,
          mimeType: 'image/jpeg',
          timestamp: Date.now(),
          source: 'webcam' 
        })
      });
      if (res.ok) {
        emitPerceptionEvent({ type: 'frame', title: 'Webcam frame ingested', detail: statusText, status: 'ok' });
      }
    } catch (e) {
      emitPerceptionEvent({ type: 'frame', title: 'Webcam frame dropped', detail: e.message, status: 'warn' });
    }
  };

  useEffect(() => {
    return () => stopVision();
  }, []);

  return (
    <div className="relative group">
      {/* Hidden processing elements */}
      <video ref={videoRef} autoPlay playsInline className="hidden" />
      <canvas ref={canvasRef} width="320" height="240" className="hidden" />

      {/* Visual Indicator */}
      <button 
        onClick={() => isVisionActive ? stopVision() : startVision()}
        className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${
          isVisionActive 
          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-lg shadow-cyan-500/10' 
          : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'
        }`}
      >
        {isVisionActive ? <Eye className="w-4 h-4 animate-pulse" /> : <EyeOff className="w-4 h-4" />}
        <span className="text-[9px] font-black uppercase tracking-[0.12em] whitespace-nowrap">
          {isVisionActive ? 'Live' : 'Enable'}
        </span>
      </button>

      {/* Discovery Toast (if SOMA sees something) */}
      <AnimatePresence>
        {isVisionActive && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute top-12 left-0 w-48 p-3 rounded-lg bg-black/80 backdrop-blur-md border border-cyan-500/20 z-50"
          >
            <div className="flex items-center gap-2 mb-1">
               <Zap className="w-3 h-3 text-cyan-400" />
               <p className="text-[8px] font-bold text-cyan-400 uppercase tracking-widest">SOMA Perception</p>
            </div>
            <p className="text-[10px] text-zinc-400 italic">{statusText}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {!isVisionActive && statusText === 'Camera unavailable' && (
        <div className="absolute top-12 left-0 w-52 p-3 rounded-lg bg-black/80 backdrop-blur-md border border-amber-500/20 z-50">
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-3 h-3 text-amber-400" />
            <p className="text-[8px] font-bold text-amber-400 uppercase tracking-widest">No Camera Found</p>
          </div>
          <p className="text-[10px] text-zinc-400">Desktop vision and image upload still work.</p>
        </div>
      )}
    </div>
  );
};

export default ArgusEye;
