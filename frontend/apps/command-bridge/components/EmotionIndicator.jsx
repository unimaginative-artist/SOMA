import React from 'react';
import { Heart, Zap, ThermometerSun, Sparkles, Activity } from 'lucide-react';
import { useEmotionalState } from '../hooks/useEmotionalState';

/**
 * EmotionIndicator - Shows SOMA's REAL emotional state
 * Powered by EmotionalEngine backend - LIVE DATA!
 */
const EmotionIndicator = ({ isTalking, isThinking, isConnected }) => {
  const { emotionalState, isLoading, error } = useEmotionalState(isConnected);

  // Emotion colors mapped to backend emotions
  const emotionColors = {
    happy: 'from-yellow-400 to-orange-500',
    joy: 'from-yellow-400 to-orange-500',
    excited: 'from-pink-500 to-purple-600',
    excitement: 'from-pink-500 to-purple-600',
    curious: 'from-blue-400 to-cyan-500',
    curiosity: 'from-blue-400 to-cyan-500',
    thoughtful: 'from-indigo-500 to-purple-600',
    focused: 'from-blue-600 to-indigo-700',
    focus: 'from-blue-600 to-indigo-700',
    calm: 'from-green-400 to-teal-500',
    satisfaction: 'from-green-400 to-teal-500',
    neutral: 'from-gray-400 to-gray-600',
    confident: 'from-purple-500 to-pink-500',
    confidence: 'from-purple-500 to-pink-500',
    creative: 'from-fuchsia-400 to-purple-600',
    creativity: 'from-fuchsia-400 to-purple-600',
    playful: 'from-orange-400 to-pink-500',
    playfulness: 'from-orange-400 to-pink-500'
  };

  const gradientClass = emotionColors[emotionalState.mood] || emotionColors.neutral;

  if (isLoading) {
    return (
      <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl p-3 border border-white/10">
        <div className="flex items-center justify-center space-x-2 text-gray-500">
          <Activity className="w-4 h-4 animate-pulse" />
          <span className="text-xs">Loading emotional state...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl p-3 border border-red-500/20">
        <div className="text-xs text-red-400">Emotion data unavailable</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl p-3 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-1">
          <span className="text-xs font-medium text-gray-400">Emotional State</span>
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="Live data" />
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-gradient-to-r ${gradientClass} text-white capitalize`}>
          {emotionalState.mood}
        </span>
      </div>

      <div className="space-y-2">
        {/* Energy */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <Zap className="w-3 h-3 text-yellow-400" />
              <span className="text-[10px] text-gray-400">Energy</span>
            </div>
            <span className="text-[10px] text-gray-300">{Math.round(emotionalState.energy * 100)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-yellow-400 to-orange-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${emotionalState.energy * 100}%` }}
            />
          </div>
        </div>

        {/* Warmth */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <Heart className="w-3 h-3 text-pink-400" />
              <span className="text-[10px] text-gray-400">Warmth</span>
            </div>
            <span className="text-[10px] text-gray-300">{Math.round(emotionalState.warmth * 100)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-pink-400 to-red-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${emotionalState.warmth * 100}%` }}
            />
          </div>
        </div>

        {/* Creativity */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-gray-400">Creativity</span>
            </div>
            <span className="text-[10px] text-gray-300">{Math.round(emotionalState.creativity * 100)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-purple-400 to-pink-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${emotionalState.creativity * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-white/5">
        <p className="text-[9px] text-gray-600 flex items-center space-x-1">
          <ThermometerSun className="w-2.5 h-2.5" />
          <span>Powered by Emotional Engine</span>
        </p>
      </div>
    </div>
  );
};

export default EmotionIndicator;
