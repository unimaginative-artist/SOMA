import { useEffect } from 'react';
import { toast } from 'react-toastify';

/**
 * useRealtimeEvents - Subscribe to SOMA backend events via WebSocket
 * Shows toast notifications for autonomous activities
 */
export const useRealtimeEvents = (somaBackend, isConnected) => {
  useEffect(() => {
    if (!isConnected || !somaBackend) return;

    // Subscribe to autonomous events
    const handleGoalCreated = (data) => {
      toast.info(`🎯 New Goal: ${data.goal}`, {
        autoClose: 5000,
        icon: '🎯'
      });
    };

    const handleGoalCompleted = (data) => {
      toast.success(`✅ Goal Complete: ${data.goal}`, {
        autoClose: 5000,
        icon: '✅'
      });
    };

    const handleSkillCertified = (data) => {
      toast.success(`🏆 Skill Mastered: ${data.skill}`, {
        autoClose: 7000,
        icon: '🏆'
      });
    };

    const handleDreamInsight = (data) => {
      toast.info(`💭 Dream Insight: ${data.insight || 'Processing counterfactuals...'}`, {
        autoClose: 6000,
        icon: '💭'
      });
    };

    const handleBeliefUpdate = (data) => {
      if (data.type === 'contradiction') {
        toast.warn(`⚠️ Belief Contradiction Detected`, {
          autoClose: 5000,
          icon: '⚠️'
        });
      } else {
        toast.info(`🧠 Belief Updated: ${data.domain || 'System'}`, {
          autoClose: 4000,
          icon: '🧠'
        });
      }
    };

    const handleLearningVelocity = (data) => {
      if (data.velocity > 1.8) {
        toast.success(`📈 Learning Velocity: ${data.velocity.toFixed(1)}x target!`, {
          autoClose: 5000,
          icon: '📈'
        });
      } else if (data.velocity < 1.2) {
        toast.warn(`📉 Learning Velocity below target: ${data.velocity.toFixed(1)}x`, {
          autoClose: 5000,
          icon: '📉'
        });
      }
    };

    const handleCuriosityExploration = (data) => {
      toast.info(`🔍 Exploring: ${data.topic || 'New knowledge domain'}`, {
        autoClose: 4000,
        icon: '🔍'
      });
    };

    const handleMemoryTierPromotion = (data) => {
      toast.info(`🚀 Memory promoted to ${data.tier} tier`, {
        autoClose: 3000,
        icon: '🚀'
      });
    };

    // Register event listeners
    somaBackend.on('goal:created', handleGoalCreated);
    somaBackend.on('goal:completed', handleGoalCompleted);
    somaBackend.on('skill:certified', handleSkillCertified);
    somaBackend.on('dream:insight', handleDreamInsight);
    somaBackend.on('belief:update', handleBeliefUpdate);
    somaBackend.on('learning:velocity', handleLearningVelocity);
    somaBackend.on('curiosity:exploration', handleCuriosityExploration);
    somaBackend.on('memory:promotion', handleMemoryTierPromotion);

    // Cleanup
    return () => {
      somaBackend.off('goal:created', handleGoalCreated);
      somaBackend.off('goal:completed', handleGoalCompleted);
      somaBackend.off('skill:certified', handleSkillCertified);
      somaBackend.off('dream:insight', handleDreamInsight);
      somaBackend.off('belief:update', handleBeliefUpdate);
      somaBackend.off('learning:velocity', handleLearningVelocity);
      somaBackend.off('curiosity:exploration', handleCuriosityExploration);
      somaBackend.off('memory:promotion', handleMemoryTierPromotion);
    };
  }, [somaBackend, isConnected]);
};
