import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { PortfolioItem, UserProfile, WidgetData } from '../../types';
import { motion, AnimatePresence } from 'framer-motion';
import { MOCK_PORTFOLIO } from '../../constants';

interface Props {
  data: WidgetData;
  currentUser?: UserProfile;
  onNavigate?: (view: string, context?: any) => void;
}

const ArtDisplayWidget: React.FC<Props> = ({ data, currentUser, onNavigate }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animKey, setAnimKey] = useState<string>('fade');
  const portfolio = useMemo<PortfolioItem[]>(() => {
    const saved = (currentUser as any)?.studio?.portfolio;
    return Array.isArray(saved) && saved.length ? saved : MOCK_PORTFOLIO;
  }, [currentUser]);

  // Transition Types
  const EFFECTS = [
    'fade', 'crossFade',
    'slideLeft', 'slideRight', 'slideUp', 'slideDown',
    'zoomIn', 'zoomOut',
    'blur',
    'rotate',
    'flip',
    'elastic'
  ];

  useEffect(() => {
    const timer = setInterval(() => {
        setAnimKey(getRandomEffect());
        setCurrentIndex((prev) => (prev + 1) % Math.max(portfolio.length, 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [portfolio.length]);

  useEffect(() => {
    if (currentIndex >= portfolio.length) setCurrentIndex(0);
  }, [currentIndex, portfolio.length]);

  const getRandomEffect = () => {
      return EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
  };

  const nextSlide = () => {
    setAnimKey(getRandomEffect());
    setCurrentIndex((prev) => (prev + 1) % Math.max(portfolio.length, 1));
  };

  const handleOpenPortfolio = () => {
      if (onNavigate) {
          onNavigate('portfolio');
      }
  };

  const currentItem = portfolio[currentIndex] || MOCK_PORTFOLIO[0];

  const getVariants = (key: string) => {
    const baseTransition = { duration: 0.8, ease: [0.22, 1, 0.36, 1] };
    const baseExit = { opacity: 0, zIndex: 0, transition: { duration: 0.6 } };
    const baseEnter = { zIndex: 1, opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)', rotate: 0, rotateX: 0, rotateY: 0 };

    switch(key) {
        case 'slideLeft': 
          return { initial: { x: '100%' }, animate: baseEnter, exit: { x: '-20%', opacity: 0 } };
        case 'slideRight': 
          return { initial: { x: '-100%' }, animate: baseEnter, exit: { x: '20%', opacity: 0 } };
        case 'slideUp': 
          return { initial: { y: '100%' }, animate: baseEnter, exit: { y: '-20%', opacity: 0 } };
        case 'slideDown': 
          return { initial: { y: '-100%' }, animate: baseEnter, exit: { y: '20%', opacity: 0 } };
        case 'zoomIn':
          return { initial: { scale: 1.2, opacity: 0 }, animate: baseEnter, exit: { scale: 0.8, opacity: 0 } };
        case 'zoomOut':
          return { initial: { scale: 0.8, opacity: 0 }, animate: baseEnter, exit: { scale: 1.2, opacity: 0 } };
        case 'blur':
          return { initial: { filter: 'blur(10px)', opacity: 0 }, animate: baseEnter, exit: { filter: 'blur(10px)', opacity: 0 } };
        case 'rotate':
           return { initial: { rotate: 5, scale: 1.1, opacity: 0 }, animate: baseEnter, exit: { rotate: -5, opacity: 0 } };
        case 'flip':
           return { initial: { rotateY: 90, opacity: 0 }, animate: baseEnter, exit: { rotateY: -90, opacity: 0 } };
        case 'elastic':
           return { initial: { x: '100%' }, animate: { ...baseEnter, transition: { type: 'spring', bounce: 0.4 } }, exit: { x: '-50%', opacity: 0 } };
        case 'crossFade':
           return { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 1.5 } }, exit: { opacity: 0, transition: { duration: 1.5 } } };
        case 'fade':
        default:
          return { initial: { opacity: 0 }, animate: baseEnter, exit: { opacity: 0 } };
    }
  };

  return (
    <div 
        onClick={handleOpenPortfolio}
        className="w-full h-full relative group overflow-hidden bg-black rounded-3xl cursor-pointer"
    >
      
      {/* Main Image Slider */}
      <AnimatePresence initial={false}>
        <motion.div
          key={currentIndex}
          variants={getVariants(animKey)}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 w-full h-full"
        >
           <img 
            src={currentItem.image} 
            alt={currentItem.title} 
            className="w-full h-full object-cover opacity-80"
           />
           <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />
        </motion.div>
      </AnimatePresence>

      {/* Overlay Content */}
      <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 md:p-8 pointer-events-none">
          
          {/* Top Bar */}
          <div className="flex justify-between items-start">
             <div className="bg-black/30 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest text-white/80">
                 Featured Work
             </div>
          </div>

          {/* Bottom Info */}
          <div className="flex items-end justify-between">
              <div className="pointer-events-auto group/text">
                  <motion.h2 
                    key={`t-${currentIndex}`}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl md:text-3xl font-display font-bold text-white mb-1 group-hover/text:text-emerald-400 transition-colors"
                  >
                      {currentItem.title}
                  </motion.h2>
                  <motion.div 
                    key={`c-${currentIndex}`}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="flex items-center gap-3 text-sm text-white/60"
                  >
                      <span>{currentItem.category}</span>
                      <span className="w-1 h-1 bg-white/40 rounded-full"></span>
                      <span className="font-mono">{currentItem.year}</span>
                  </motion.div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default ArtDisplayWidget;
