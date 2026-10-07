import * as React from 'react';
import { useState } from 'react';
import { WidgetData, UserProfile } from '../../types';
import { Sparkles, Loader2, Zap, BrainCircuit, Feather, Lightbulb } from 'lucide-react';
import { generateCreativeArtifact, CreativeArtifact } from '../../services/geminiService';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    data: WidgetData;
    allWidgets?: WidgetData[];
    userProfile?: UserProfile;
}

const OracleWidget: React.FC<Props> = ({ data, allWidgets, userProfile }) => {
  const [artifact, setArtifact] = useState<CreativeArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const handleConsult = async () => {
    setLoading(true);
    
    // Extract context from other widgets AND the profile
    const textWidget = allWidgets?.find(w => w.type === 'TEXT');
    
    const context = {
        name: userProfile?.name,
        role: userProfile?.role,
        bio: userProfile?.bio,
        manifesto: textWidget?.content?.text,
    };

    const result = await generateCreativeArtifact(context);
    setArtifact(result);
    setHasGenerated(true);
    setLoading(false);
  };

  const renderIcon = (type: string) => {
    switch(type) {
        case 'MYTH': return <Feather size={16} className="text-pink-400" />;
        case 'CONCEPT': return <Lightbulb size={16} className="text-yellow-400" />;
        default: return <BrainCircuit size={16} className="text-cyan-400" />;
    }
  };

  const getGradient = (type?: string) => {
      switch(type) {
          case 'MYTH': return 'from-pink-500/10 via-purple-500/5 to-transparent';
          case 'CONCEPT': return 'from-yellow-500/10 via-orange-500/5 to-transparent';
          default: return 'from-cyan-500/10 via-blue-500/5 to-transparent'; // QUOTE
      }
  };

  return (
    <div className={`w-full h-full flex flex-col relative overflow-hidden group transition-all duration-1000 bg-gradient-to-br ${getGradient(artifact?.type)}`}>
      
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 z-0">
          <div className={`absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.22)_0,transparent_62%)] opacity-10 ${loading ? 'animate-pulse' : ''}`}></div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-2 relative z-10">
        <div className="flex items-center gap-2 text-white/60">
            <BrainCircuit size={16} className={loading ? 'text-yellow-200 animate-pulse' : 'text-white/60'} />
            <span className="text-xs font-mono uppercase tracking-widest">Inspire Me</span>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 text-center">
        <AnimatePresence mode="wait">
            {!hasGenerated && !loading && (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center gap-4"
                >
                    <p className="text-white/40 font-display text-lg max-w-[200px]">
                        The system is listening.
                    </p>
                </motion.div>
            )}

            {loading && (
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-3"
                >
                    <Loader2 size={32} className="animate-spin text-white/20" />
                    <span className="text-xs font-mono text-white/30 uppercase tracking-widest">Synthesizing Identity...</span>
                </motion.div>
            )}

            {hasGenerated && artifact && !loading && (
                <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    transition={{ duration: 0.8, ease: "circOut" }}
                    className="flex flex-col items-center justify-center h-full"
                >
                    <div className="flex items-center gap-2 mb-3 opacity-50">
                        {renderIcon(artifact.type)}
                        <span className="text-[10px] font-mono uppercase tracking-[0.2em]">{artifact.type}</span>
                    </div>
                    
                    <h3 className="text-xs font-bold text-white/30 mb-4 uppercase tracking-widest">{artifact.title}</h3>
                    
                    <p className="font-display text-xl md:text-2xl leading-relaxed text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60">
                        "{artifact.content}"
                    </p>
                </motion.div>
            )}
        </AnimatePresence>
      </div>

      {/* Action Button */}
      <div className="p-6 pt-2 relative z-10">
        <button 
            onClick={handleConsult}
            disabled={loading}
            className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/30 rounded-lg text-xs md:text-sm font-medium uppercase tracking-widest text-white/70 hover:text-white transition-all flex items-center justify-center gap-3 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
            {loading ? (
                <>Processing...</>
            ) : (
                <>
                    <Sparkles size={14} />
                    {hasGenerated ? 'Inspire Me Again' : 'Inspire Me'}
                </>
            )}
        </button>
      </div>
    </div>
  );
};

export default OracleWidget;
