import React, { useState, useEffect, useRef } from 'react';

export const StreamingText = ({ text, speed = 15 }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef(null);
  const textRef = useRef(text);
  textRef.current = text; // Keep ref updated with the latest text prop

  useEffect(() => {
    setDisplayedText('');
    setIsComplete(false);
    
    let i = 0;
    intervalRef.current = window.setInterval(() => {
      if (i < textRef.current.length) {
        setDisplayedText(prev => prev + textRef.current.charAt(i));
        i++;
      } else {
        if(intervalRef.current) clearInterval(intervalRef.current);
        setIsComplete(true);
      }
    }, speed);

    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        if(intervalRef.current) clearInterval(intervalRef.current);
        setDisplayedText(textRef.current);
        setIsComplete(true);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      if(intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [text, speed]);

  return <pre className="whitespace-pre-wrap font-mono">{displayedText}{!isComplete && <span className="animate-pulse">▌</span>}</pre>;
};
