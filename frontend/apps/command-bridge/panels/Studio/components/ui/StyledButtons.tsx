import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';

// Helper for unique IDs
const useScopedId = (prefix: string) => {
    const id = React.useId();
    return `${prefix}-${id.replace(/:/g, '')}`;
};

// 0. COSMOS (The Space One)
export const CosmosButton = ({ text, onClick, color = '#f5434f' }: any) => {
    const className = useScopedId('cosmos-btn');
    return (
        <button className={`${className} w-full relative`} onClick={onClick} type="button">
            <style>{`
                .${className} {
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-width: 100px;
                  overflow: hidden;
                  height: 3rem;
                  background-size: 300% 300%;
                  backdrop-filter: blur(1rem);
                  border-radius: 9999px;
                  transition: 0.5s;
                  animation: gradient_301 5s ease infinite;
                  border: double 4px transparent;
                  background-image: linear-gradient(#161a25, #161a25),
                    linear-gradient(
                      137.48deg,
                      ${color} 10%,
                      ${color}66 45%,
                      #000000 67%,
                      #161a25 87%
                    );
                  background-origin: border-box;
                  background-clip: content-box, border-box;
                  font-family: "Space Grotesk", sans-serif;
                }
    
                .${className} .cosmos-strong {
                  z-index: 2;
                  font-family: "Space Grotesk", sans-serif;
                  font-size: 12px;
                  letter-spacing: 1px;
                  color: #ffffff;
                  text-shadow: 0 0 4px white;
                  text-transform: uppercase;
                  font-weight: 700;
                }
    
                .${className}:hover {
                  transform: scale(1.05);
                }
    
                .${className} .cosmos-stars {
                  position: relative;
                  background: transparent;
                  width: 200rem;
                  height: 200rem;
                }
    
                .${className} .cosmos-stars::after {
                  content: "";
                  position: absolute;
                  top: -10rem;
                  left: -100rem;
                  width: 100%;
                  height: 100%;
                  animation: animStarRotate 90s linear infinite;
                  background-image: radial-gradient(#ffffff 1px, transparent 1%);
                  background-size: 50px 50px;
                }
    
                @keyframes animStarRotate {
                  from { transform: rotate(360deg); }
                  to { transform: rotate(0); }
                }
    
                @keyframes gradient_301 {
                  0% { background-position: 0% 50%; }
                  50% { background-position: 100% 50%; }
                  100% { background-position: 0% 50%; }
                }
            `}</style>
            <strong className="cosmos-strong">{text}</strong>
            <div className="absolute inset-0 z-0 overflow-hidden rounded-full pointer-events-none">
                <div className="cosmos-stars"></div>
            </div>
        </button>
    );
};

// 0.5 MULTICOLOR (Gradient)
export const MulticolorButton = ({ text, onClick, color = '#a855f7' }: any) => {
    // Mostly inline, but using scope for safety if we add more CSS later
    return (
        <button onClick={onClick} className="relative inline-flex items-center justify-center w-full px-6 py-3 overflow-hidden font-bold text-white transition-all duration-300 bg-transparent rounded-xl hover:scale-[1.02] group border border-white/10 h-[3rem]">
            <span 
                className="absolute inset-0 w-full h-full opacity-80 group-hover:opacity-100 transition-opacity" 
                style={{ 
                    background: `linear-gradient(135deg, ${color}, #000000, ${color})`,
                    backgroundSize: '200% 200%',
                    animation: 'gradient_move 3s ease infinite'
                }}
            >
                <style>{`
                    @keyframes gradient_move {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                    }
                `}</style>
            </span>
            <span className="absolute bottom-0 right-0 block w-64 h-64 mb-32 mr-4 transition duration-500 origin-bottom-left transform rotate-45 translate-x-24 opacity-30 group-hover:rotate-90 ease" style={{ background: color }}></span>
            <span className="relative z-10 uppercase tracking-wider text-xs flex items-center gap-2">{text} <ArrowUpRight size={14}/></span>
        </button>
    );
};

// 1. ORBIT (Simple)
export const OrbitButton = ({ text, onClick, color = '#a855f7' }: any) => {
    const className = useScopedId('orbit-btn');
    return (
        <button className={`${className} w-full h-[3rem] relative overflow-hidden rounded-xl group`} onClick={onClick} style={{ boxShadow: `0 0 20px ${color}20` }}>
            <style>{`
                .${className} { background: linear-gradient(135deg, ${color}20, #000); border: 1px solid ${color}40; }
                @keyframes orbit-simple { from { transform: rotate(0deg) translateX(50px) rotate(0deg); } to { transform: rotate(360deg) translateX(50px) rotate(-360deg); } }
            `}</style>
            <div className="absolute inset-0 z-0 flex items-center justify-center">
                 <div className="absolute w-20 h-20 rounded-full blur-2xl opacity-40" style={{ background: color }} />
            </div>
            <span className="relative z-10 font-bold uppercase tracking-wider text-white text-xs">{text}</span>
        </button>
    );
};

// 2. NEON (Redesigned)
export const NeonButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] relative group bg-transparent focus:outline-none overflow-hidden rounded-md transition-all duration-300" 
        style={{ 
            color: '#fff',
            textShadow: `0 0 5px ${color}, 0 0 10px ${color}`
        }}
    >
        <span className="absolute inset-0 border-2 rounded-md opacity-80 group-hover:opacity-100 transition-opacity duration-300" style={{ borderColor: color, boxShadow: `0 0 10px ${color}, inset 0 0 10px ${color}` }}></span>
        <span className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-100"></span>
        <span className="relative z-10 font-bold uppercase tracking-wider text-sm">{text}</span>
    </button>
);

// 3. BRUTALIST
export const BrutalistButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] bg-white text-black font-black uppercase tracking-tight text-sm border-4 border-black transition-transform active:translate-y-1 hover:-translate-y-1 hover:shadow-xl" style={{ boxShadow: `4px 4px 0px ${color}` }}>
        {text}
    </button>
);

// 4. MINIMAL (Cleaned Up)
export const MinimalButton = ({ text, onClick, color = '#fff' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] border border-white/20 hover:border-white rounded-lg font-medium text-xs uppercase tracking-wider text-white transition-all bg-transparent group relative overflow-hidden">
        <span className="absolute bottom-0 left-0 w-full h-[1px] bg-white transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
        <span className="relative z-10">{text}</span>
    </button>
);

// 5. GLITCH (Functional)
export const GlitchButton = ({ text, onClick, color = '#a855f7' }: any) => {
    const className = useScopedId('glitch-btn');
    return (
        <button 
            onClick={onClick} 
            className={`${className} w-full h-[3rem] relative bg-black text-white font-mono font-bold uppercase tracking-wide overflow-hidden border border-white/10 group`}
            data-text={text}
        >
             <style>{`
                .${className}::before, .${className}::after {
                    content: attr(data-text);
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: #000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0.8;
                }
                .${className}:hover::before {
                    color: #ff00ff;
                    z-index: -1;
                    animation: glitch-anim-1 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both infinite;
                }
                .${className}:hover::after {
                    color: #00ffff;
                    z-index: -2;
                    animation: glitch-anim-2 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) reverse both infinite;
                }
                @keyframes glitch-anim-1 {
                    0% { clip-path: inset(20% 0 80% 0); transform: translate(-2px, 1px); }
                    20% { clip-path: inset(60% 0 10% 0); transform: translate(2px, -1px); }
                    40% { clip-path: inset(40% 0 50% 0); transform: translate(-2px, 2px); }
                    60% { clip-path: inset(80% 0 5% 0); transform: translate(2px, -2px); }
                    80% { clip-path: inset(10% 0 70% 0); transform: translate(-1px, 1px); }
                    100% { clip-path: inset(30% 0 20% 0); transform: translate(1px, -1px); }
                }
                @keyframes glitch-anim-2 {
                    0% { clip-path: inset(10% 0 60% 0); transform: translate(2px, -1px); }
                    20% { clip-path: inset(80% 0 5% 0); transform: translate(-2px, 2px); }
                    40% { clip-path: inset(30% 0 20% 0); transform: translate(2px, -1px); }
                    60% { clip-path: inset(10% 0 80% 0); transform: translate(-1px, 1px); }
                    80% { clip-path: inset(50% 0 30% 0); transform: translate(1px, -2px); }
                    100% { clip-path: inset(20% 0 70% 0); transform: translate(-2px, 2px); }
                }
             `}</style>
             <span className="relative z-10 flex items-center justify-center gap-2">
                {text}
             </span>
             <div className="absolute bottom-0 left-0 w-full h-0.5 group-hover:h-full group-hover:opacity-10 transition-all duration-200" style={{ background: color }} />
        </button>
    );
};

// 6. SOFT (Redesigned)
export const SoftButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] rounded-full font-bold text-sm text-white transition-all hover:-translate-y-0.5 hover:shadow-lg flex items-center justify-center gap-2 border border-white/5" 
        style={{ 
            background: `linear-gradient(180deg, ${color}dd 0%, ${color} 100%)`,
            boxShadow: `0 4px 15px -3px ${color}66, inset 0 1px 0 rgba(255,255,255,0.3)`
        }}
    >
        {text}
    </button>
);

// 7. GLASS (Redesigned)
export const GlassButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] rounded-xl font-medium text-xs uppercase tracking-wider text-white transition-all relative overflow-hidden group hover:bg-white/5" 
        style={{ 
            backdropFilter: 'blur(12px)',
            background: 'rgba(255, 255, 255, 0.03)',
            borderTop: '1px solid rgba(255, 255, 255, 0.2)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'
        }}
    >
        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <span className="relative z-10 drop-shadow-md">{text}</span>
    </button>
);

// 8. CYBER
export const CyberButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] bg-black text-white font-mono text-xs uppercase border-l-4 border-r-4 hover:bg-white/5 transition-colors" style={{ borderColor: color, clipPath: 'polygon(10% 0, 100% 0, 100% 70%, 90% 100%, 0 100%, 0 30%)' }}>
        {text}
    </button>
);

// 9. RETRO
export const RetroButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] bg-[#ccc] border-t-4 border-l-4 border-white border-b-4 border-r-4 border-[#444] text-black font-mono font-bold text-xs uppercase active:border-t-[#444] active:border-l-[#444] active:border-b-white active:border-r-white active:bg-[#bbb]">
        {text}
    </button>
);

// 10. LIQUID
export const LiquidButton = ({ text, onClick, color = '#a855f7' }: any) => (
    <button onClick={onClick} className="w-full h-[3rem] rounded-full bg-white text-black font-bold uppercase text-xs tracking-wider hover:rounded-[30%_70%_70%_30%/30%_30%_70%_70%] transition-all duration-500 ease-in-out shadow-lg" style={{ boxShadow: `0 10px 20px -10px ${color}` }}>
        {text}
    </button>
);

// RENDERER
export const RENDER_BUTTON = (style: string, props: any) => {
    switch (style) {
        case 'COSMOS': return <CosmosButton {...props} />;
        case 'MULTICOLOR': return <MulticolorButton {...props} />;
        case 'NEON': return <NeonButton {...props} />;
        case 'BRUTALIST': return <BrutalistButton {...props} />;
        case 'MINIMAL': return <MinimalButton {...props} />;
        case 'GLITCH': return <GlitchButton {...props} />;
        case 'SOFT': return <SoftButton {...props} />;
        case 'GLASS': return <GlassButton {...props} />;
        case 'CYBER': return <CyberButton {...props} />;
        case 'RETRO': return <RetroButton {...props} />;
        case 'LIQUID': return <LiquidButton {...props} />;
        case 'ORBIT':
        default: return <OrbitButton {...props} />;
    }
};