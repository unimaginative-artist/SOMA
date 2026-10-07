import React, { useEffect, useRef } from 'react';

export const SpaceBackground = ({ enabled = true }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!enabled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        const stars = [];
        const particles = [];

        // Configuration
        const STAR_COUNT = 150;
        const PARTICLE_COUNT = 40;

        // Initialize Stars (Twinkling background)
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 1.5,
                opacity: Math.random(),
                twinkleSpeed: 0.005 + Math.random() * 0.01,
                direction: Math.random() > 0.5 ? 1 : -1
            });
        }

        // Initialize Particles (Floating dust)
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 2 + 0.5,
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2,
                opacity: Math.random() * 0.5 + 0.1
            });
        }

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        };

        window.addEventListener('resize', handleResize);

        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            // Draw Gradient Background directly on canvas or let CSS handle it?
            // User requested: Edges match gray scheme (#0d0d0e), Center lightens to dark blue.
            // We'll let CSS handle the base gradient for better responsive blending, but we can overlay here if needed.
            // Actually, let's keep the canvas transparent and layer it ON TOP of the CSS gradient for better performance/flexibility.

            const cx = width / 2;
            const cy = height / 2;
            const maxDist = Math.sqrt(cx * cx + cy * cy);

            // Draw Stars
            stars.forEach(star => {
                // Update opacity for twinkle
                star.opacity += star.twinkleSpeed * star.direction;
                if (star.opacity > 1 || star.opacity < 0.2) {
                    star.direction *= -1;
                }

                // Calculate distance from center for edge fading
                const dist = Math.sqrt(Math.pow(star.x - cx, 2) + Math.pow(star.y - cy, 2));
                const edgeFade = Math.max(0, 1 - (dist / (maxDist * 0.8))); // Fade out towards edges

                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * edgeFade * 0.8})`;
                ctx.fill();
            });

            // Draw Particles
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;

                // Wrap around screen
                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;

                // Edge fade for particles too
                const dist = Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2));
                const edgeFade = Math.max(0, 1 - (dist / (maxDist * 0.7)));

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200, 220, 255, ${p.opacity * edgeFade * 0.6})`; // Slightly blue-ish dust
                ctx.fill();
            });

            requestAnimationFrame(animate);
        };

        const animId = requestAnimationFrame(animate);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animId);
        };
    }, [enabled]);

    if (!enabled) {
        return (
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-950/40 via-[#0d0d0e] to-[#0d0d0e]"></div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-0 pointer-events-none">
            {/* Base Radial Gradient: Dark Blue Center -> Zinc Edges */}
            {/* Using Slate-950/Zinc-950 hybrid for the edges and Blue-900/950 for center */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-950/40 via-[#0d0d0e] to-[#0d0d0e]"></div>

            {/* Canvas for Stars/Particles */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-60 mix-blend-screen" />
        </div>
    );
};
