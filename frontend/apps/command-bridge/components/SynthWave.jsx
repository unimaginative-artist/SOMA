import React, { useEffect, useRef } from 'react';

const SynthWave = ({ volume, isTalking, isActive, isListening = false, isThinking = false }) => {
  const canvasRef = useRef(null);
  const frameRef = useRef();
  const timeRef = useRef(0);
  const displayVolumeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const MID = H / 2;

    const draw = () => {
      timeRef.current += isTalking ? 0.045 : isListening ? 0.032 : 0.024;
      const t = timeRef.current;

      const idleFloor = isThinking ? 0.11 : isListening ? 0.08 : 0.045;
      const target = isActive ? (isTalking ? Math.max(volume, 0.1) : idleFloor) : 0;
      displayVolumeRef.current += (target - displayVolumeRef.current) * 0.11;
      const amp = displayVolumeRef.current * (H * 0.38);

      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W / 2, MID, 0, W / 2, MID, W / 2);
      bg.addColorStop(0, isThinking ? 'rgba(251,191,36,0.08)' : isListening ? 'rgba(34,211,238,0.08)' : 'rgba(168,85,247,0.08)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const layers = [
        { freq: 1.45, phaseOff: 0, alpha: 0.22, width: 1.1, color: isListening ? '34,211,238' : isThinking ? '251,191,36' : '139,92,246' },
        { freq: 2.15, phaseOff: Math.PI / 3, alpha: 0.48, width: 1.7, color: isListening ? '96,165,250' : isThinking ? '249,115,22' : '168,85,247' },
        { freq: 3.2, phaseOff: -Math.PI / 5, alpha: 0.85, width: 2.1, color: isListening ? '125,211,252' : isThinking ? '252,211,77' : '217,70,239' },
      ];

      for (const layer of layers) {
        ctx.beginPath();
        ctx.lineWidth = layer.width;
        ctx.shadowBlur = isTalking ? 18 : isListening || isThinking ? 10 : 6;
        ctx.shadowColor = `rgba(${layer.color},${layer.alpha * 0.6})`;
        ctx.strokeStyle = `rgba(${layer.color},${layer.alpha})`;

        for (let x = 0; x <= W; x += 2) {
          const px = x / W;
          const envelope = Math.sin(px * Math.PI);
          const y = MID
            + Math.sin(px * Math.PI * 2 * layer.freq + t + layer.phaseOff) * amp * envelope
            + Math.sin(px * Math.PI * 4 * layer.freq + t * 1.25 + layer.phaseOff) * amp * 0.22 * envelope
            + Math.sin(px * Math.PI * 12 + t * 0.7) * (isTalking ? volume * 7 : 1.5) * envelope;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (isActive) {
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = isListening ? 'rgba(34,211,238,0.35)' : 'rgba(168,85,247,0.35)';
        ctx.strokeStyle = isListening ? 'rgba(34,211,238,0.22)' : 'rgba(168,85,247,0.24)';
        ctx.moveTo(W * 0.08, MID);
        ctx.lineTo(W * 0.92, MID);
        ctx.stroke();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    // Restart loop when tab becomes visible (browser pauses rAF on hidden tabs)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [volume, isTalking, isActive, isListening, isThinking]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={80}
      style={{
        opacity: isActive ? 1 : 0,
        transition: 'opacity 0.8s ease',
        display: 'block',
      }}
    />
  );
};

export default SynthWave;
