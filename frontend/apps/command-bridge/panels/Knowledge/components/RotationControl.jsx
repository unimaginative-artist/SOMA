import React, { useRef, useState, useEffect } from 'react';

export const RotationControl = ({ rotation, onRotate }) => {
    const [isDragging, setIsDragging] = useState(false);
    const startPos = useRef({ x: 0, y: 0 });
    const startRotation = useRef({ x: 0, y: 0 });

    const handleStart = (clientX, clientY) => {
        setIsDragging(true);
        startPos.current = { x: clientX, y: clientY };
        startRotation.current = { ...rotation };
    };

    const handleMouseDown = (e) => {
        handleStart(e.clientX, e.clientY);
    };

    const handleTouchStart = (e) => {
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
    };

    useEffect(() => {
        const handleMove = (clientX, clientY) => {
            if (!isDragging) return;

            const dx = clientX - startPos.current.x;
            const dy = clientY - startPos.current.y;

            // Sensitivity factor
            const speed = 0.005;

            onRotate({
                y: startRotation.current.y + dx * speed, // Spin (Yaw)
                x: Math.max(-1, Math.min(1, startRotation.current.x - dy * speed)) // Tilt (Pitch), clamped
            });
        };

        const handleMouseMove = (e) => {
            handleMove(e.clientX, e.clientY);
        };

        const handleTouchMove = (e) => {
            const touch = e.touches[0];
            handleMove(touch.clientX, touch.clientY);
        };

        const handleEnd = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleEnd);
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleEnd);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleEnd);
        };
    }, [isDragging, onRotate]);

    return (
        <div className="absolute bottom-52 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center pointer-events-auto group touch-none">
            <div
                className={`
           relative w-64 h-8 rounded-full 
           bg-[#151518]/80 backdrop-blur-md border border-white/10 
           flex items-center justify-center cursor-ew-resize
           transition-all duration-300
           ${isDragging ? 'border-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.2)]' : 'hover:bg-white/5'}
        `}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
            >
                {/* Track */}
                <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-slate-500 to-transparent"></div>

                {/* Thumb */}
                <div
                    className="absolute top-1/2 -translate-y-1/2 w-12 h-4 bg-cyan-500/20 border border-cyan-400 rounded-full shadow-[0_0_10px_cyan] transition-transform"
                    style={{
                        left: '50%',
                        transform: `translate(-50%, -50%) translateX(${Math.sin(rotation.y) * 40}px)`
                    }}
                ></div>
            </div>

            {/* Decorative lines connecting to trace viewer */}
            <div className="w-[1px] h-8 bg-gradient-to-b from-white/10 to-transparent"></div>
        </div>
    );
};
