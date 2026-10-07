import { useState, useEffect } from 'react';

/**
 * useEmotionalState - Real-time emotional state from EmotionalEngine backend
 * Polls /api/emotions every 2 seconds for live updates
 */
export const useEmotionalState = (isConnected) => {
  const [emotionalState, setEmotionalState] = useState({
    mood: 'neutral',
    energy: 0.5,
    warmth: 0.7,
    creativity: 0.6,
    peptides: {},
    dominantEmotion: 'neutral',
    valence: 0,
    arousal: 0
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConnected) return;

    const fetchEmotionalState = async () => {
      try {
        const response = await fetch('/api/soma/orb-emotions');

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.state) {
          const state = data.state;

          // Map backend peptides to our UI representation
          setEmotionalState({
            mood: state.dominantEmotion || 'neutral',
            energy: state.peptides?.energy || state.arousal || 0.5,
            warmth: state.peptides?.warmth || state.valence || 0.7,
            creativity: state.peptides?.creativity || 0.6,
            peptides: state.peptides || {},
            dominantEmotion: state.dominantEmotion || 'neutral',
            valence: state.valence || 0,
            arousal: state.arousal || 0
          });

          setIsLoading(false);
          setError(null);
        }
      } catch (err) {
        console.warn('[useEmotionalState] Failed to fetch:', err.message);
        setError(err.message);
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchEmotionalState();

    // Poll every 2 seconds for live updates
    const interval = setInterval(fetchEmotionalState, 2000);

    return () => clearInterval(interval);
  }, [isConnected]);

  return { emotionalState, isLoading, error };
};
