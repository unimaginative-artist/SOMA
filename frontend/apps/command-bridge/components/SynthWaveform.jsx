import React, { useEffect, useRef } from 'react';

/**
 * SynthWaveform — Professional canvas waveform that reacts to SOMA's voice.
 * Driven by volume (0–1), isTalking, isListening props.
 * Multi-oscillator bars with Gaussian envelope + fuchsia/indigo glow.
 */
const SynthWaveform = ({ volume = 0, isTalking = false, isListening = false }) => {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const stateRef  = useRef({ volume: 0, isTalking: false, isListening: false });

  // Keep mutable ref in sync so animation loop never needs to restart
  useEffect(() => {
    stateRef.current = { volume, isTalking, isListening };
  }, [volume, isTalking, isListening]);

  // One-time animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const BAR_COUNT = 80;

    // Each bar gets a unique set of oscillator frequencies and starting phases
    const freqs  = Array.from({ length: BAR_COUNT }, (_, i) =>
      0.6 + (i / BAR_COUNT) * 4.2 + Math.sin(i * 0.37) * 0.3
    );
    const phases = Array.from({ length: BAR_COUNT }, (_, i) =>
      (i / BAR_COUNT) * Math.PI * 6 + Math.cos(i * 0.91) * 1.2
    );
    // Per-bar random multiplier so adjacent bars aren't perfectly correlated
    const randMul = Array.from({ length: BAR_COUNT }, () =>
      0.7 + Math.random() * 0.6
    );

    const render = (timestamp) => {
      const t = timestamp / 1000;
      const { volume: vol, isTalking: talking, isListening: listening } = stateRef.current;

      const W = canvas.width;
      const H = canvas.height;

      // Fade-clear (trail effect)
      ctx.clearRect(0, 0, W, H);

      const barWidth = W / BAR_COUNT;
      const centerY  = H / 2;
      const maxH     = H * 0.44;

      const active    = talking || listening;
      // Smooth volume floor so idle bars still breathe gently
      const baseVol   = active ? Math.max(vol, 0.14) : 0.032;
      const speedMult = talking ? 1.6 : listening ? 1.05 : 0.35;

      for (let i = 0; i < BAR_COUNT; i++) {
        const norm     = (i / BAR_COUNT) - 0.5;
        // Gaussian envelope: tall in the center, tapers to edges
        const gaussian = Math.exp(-norm * norm * 5.5);

        // Three-oscillator sum — simulates a voice's harmonic texture
        const f   = freqs[i]  * speedMult * randMul[i];
        const ph  = phases[i];
        const wave =
          0.48 * Math.sin(t * f * 2.1  + ph) +
          0.34 * Math.sin(t * f * 3.73 + ph * 1.47 + 0.3) +
          0.18 * Math.sin(t * f * 6.17 + ph * 0.83 + 1.1);

        // Final bar height
        const h    = gaussian * maxH * (baseVol * (0.55 + 0.45 * wave) + 0.012) * randMul[i];
        const absH = Math.max(1.5, Math.abs(h));

        // Color: fuchsia (#d946ef) at peak → indigo (#4f46e5) at edges
        const gL  = gaussian;
        const rC  = Math.round(217 * gL + 79  * (1 - gL));
        const gC  = Math.round(70  * gL + 70  * (1 - gL));
        const bC  = Math.round(239 * gL + 229 * (1 - gL));
        // Steeper Gaussian for alpha — edges trail off to near-invisible
        const alphaEnv = Math.exp(-norm * norm * 18);
        const alpha = alphaEnv * 0.92;

        // Glow stronger when active
        const glowStrength = gL * baseVol * (talking ? 22 : listening ? 14 : 6);
        ctx.shadowColor = `rgba(217, 70, 239, ${gL * 0.85})`;
        ctx.shadowBlur  = glowStrength;

        ctx.fillStyle = `rgba(${rC}, ${gC}, ${bC}, ${alpha})`;

        const x   = i * barWidth;
        const gap = barWidth * 0.28;
        const bw  = barWidth - gap;

        // Symmetric bar: draw both up and down from centerY
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(x + gap / 2, centerY - absH, bw, absH * 2, bw * 0.4)
          : ctx.rect(x + gap / 2, centerY - absH, bw, absH * 2);
        ctx.fill();
      }

      // Subtle center line
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(217, 70, 239, 0.12)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(W, centerY);
      ctx.stroke();

      // Edge vignette — smooth fade to black at both ends (trailing off effect)
      const vignette = ctx.createLinearGradient(0, 0, W, 0);
      vignette.addColorStop(0,    'rgba(0, 0, 0, 1)');
      vignette.addColorStop(0.06, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(0.94, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1,    'rgba(0, 0, 0, 1)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, []); // intentionally empty — reads live state via ref

  // Keep canvas pixel dimensions in sync with display size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = canvas.offsetWidth  * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export default SynthWaveform;
