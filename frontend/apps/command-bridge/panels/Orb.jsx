import React, { useState, useEffect, useRef } from 'react';

const Orb = ({ volume, isActive, isTalking, isListening, isThinking }) => {
  const [animationTime, setAnimationTime] = useState(0);
  const animationFrameRef = useRef();
  
  useEffect(() => {
    const animate = (timestamp) => {
      setAnimationTime(timestamp);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, isTalking]);
  
  const phase = animationTime / 1000;
  const voiceLift = isTalking ? Math.min(0.42, volume * 0.36) : 0;
  const breath = Math.sin(phase * 1.6) * 0.035;
  const attentionPulse = isListening ? Math.sin(phase * 3.4) * 0.075 : 0;
  const thoughtPulse = isThinking ? Math.sin(phase * 2.3) * 0.055 : 0;
  const activeScale = isActive ? 0.82 + voiceLift + breath + attentionPulse + thoughtPulse : 0.42;
  const activeOpacity = isActive ? 0.64 + Math.min(0.3, volume * 0.26) : 0.22;

  let palette = {
    core: 'rgba(255,255,255,0.96)',
    inner: 'rgba(168,85,247,0.9)',
    mid: 'rgba(217,70,239,0.68)',
    outer: 'rgba(88,28,135,0.34)',
    ring: 'rgba(232,121,249,0.58)',
    accent: 'rgba(125,211,252,0.34)'
  };
  
  if (isListening) {
    palette = {
      core: 'rgba(219,234,254,0.98)',
      inner: 'rgba(96,165,250,0.9)',
      mid: 'rgba(34,211,238,0.58)',
      outer: 'rgba(14,165,233,0.25)',
      ring: 'rgba(125,211,252,0.62)',
      accent: 'rgba(168,85,247,0.28)'
    };
  } else if (isThinking) {
    palette = {
      core: 'rgba(254,249,195,0.98)',
      inner: 'rgba(251,191,36,0.88)',
      mid: 'rgba(249,115,22,0.52)',
      outer: 'rgba(180,83,9,0.24)',
      ring: 'rgba(252,211,77,0.6)',
      accent: 'rgba(217,70,239,0.26)'
    };
  } else if (isTalking) {
    palette = {
      core: 'rgba(255,255,255,0.98)',
      inner: 'rgba(192,132,252,0.95)',
      mid: 'rgba(217,70,239,0.72)',
      outer: 'rgba(126,34,206,0.34)',
      ring: 'rgba(232,121,249,0.72)',
      accent: 'rgba(34,211,238,0.25)'
    };
  }

  return (
    <div 
      className="relative flex h-96 w-96 items-center justify-center mx-auto my-8 transition-opacity duration-700 ease-in-out"
      style={{ opacity: isActive ? 1 : 0.42 }}
    >
      {[0, 1, 2].map((ring) => (
        <div
          key={ring}
          className="absolute rounded-full border mix-blend-screen"
          style={{
            width: 240 + ring * 64,
            height: 240 + ring * 64,
            borderColor: palette.ring,
            opacity: isActive ? 0.22 - ring * 0.045 : 0.07,
            transform: `rotate(${phase * (ring % 2 ? -18 : 14)}deg) scale(${1 + Math.sin(phase * (1.2 + ring * 0.25)) * 0.018})`,
            filter: 'blur(0.2px)',
            transition: 'border-color 0.5s ease, opacity 0.5s ease'
          }}
        />
      ))}

      <div
        className="absolute h-[430px] w-[430px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${palette.accent} 0%, transparent 58%)`,
          opacity: isActive ? 0.5 : 0.18,
          transform: `translate(${Math.sin(phase * 1.1) * 12}px, ${Math.cos(phase * 0.9) * 10}px)`,
          filter: 'blur(52px)'
        }}
      />

      <div 
        className="relative flex items-center justify-center"
        style={{
          transform: `scale(${Math.max(0.34, activeScale)}) rotate(${Math.sin(phase * 0.7) * 1.5}deg)`, 
          opacity: activeOpacity,
          transition: isTalking ? 'transform 0.06s cubic-bezier(0, 0, 0.2, 1), opacity 0.08s linear' : 'transform 0.35s ease, opacity 0.35s ease',
        }}
      >
        <div
          className="absolute h-[760px] w-[760px] rounded-full mix-blend-screen"
          style={{
            background: `radial-gradient(circle, ${palette.outer} 0%, transparent 62%)`,
            filter: 'blur(110px)'
          }}
        />
        <div
          className="absolute h-[470px] w-[470px] rounded-full mix-blend-screen"
          style={{
            background: `radial-gradient(circle, ${palette.mid} 0%, transparent 68%)`,
            filter: 'blur(68px)'
          }}
        />
        <div
          className="absolute h-64 w-64 rounded-full mix-blend-screen"
          style={{
            background: `radial-gradient(circle, ${palette.inner} 0%, transparent 66%)`,
            filter: 'blur(24px)'
          }}
        />
        <div
          className="relative z-30 h-32 w-32 rounded-full"
          style={{ 
            background: `radial-gradient(circle at 42% 34%, ${palette.core} 0%, ${palette.inner} 42%, ${palette.mid} 82%)`,
            filter: 'blur(7px)',
            boxShadow: `0 0 ${isTalking ? 130 : 96}px ${palette.ring}, inset 0 0 42px rgba(255,255,255,0.55)`,
          }}
        />
        <div
          className="absolute z-40 h-16 w-16 rounded-full bg-white/80"
          style={{
            transform: `translate(${Math.sin(phase * 1.8) * 5}px, ${Math.cos(phase * 1.4) * 4}px)`,
            filter: 'blur(16px)',
            opacity: isActive ? 0.62 : 0.28
          }}
        />
      </div>
    </div>
  );
};

export default Orb;
