// src/cognitive/CognitiveState.js

export class CognitiveState {
  constructor({
    belief = {},
    goal = {},
    emotion = {},
    personality = {},
    wisdom = {} // NEW: Accumulated knowledge from the Swarm
  } = {}) {
    this.belief = belief;           // { id, confidence, dominant_belief }
    this.goal = goal;               // { id, priority, active_goal }
    this.emotion = emotion;         // { valence, arousal, mood }
    this.personality = personality; // { novelty, directness, warmth, bias }
    this.wisdom = wisdom;           // { familiarity_score, complexity_score, pattern_alignment }
    this.timestamp = Date.now();
  }

  // Helper to diff against another state (for debugging mental shifts)
  diff(otherState) {
    if (!otherState) return this;
    
    return {
      emotionChange: {
        valence: this.emotion.valence - (otherState.emotion.valence || 0),
        arousal: this.emotion.arousal - (otherState.emotion.arousal || 0)
      },
      goalChanged: this.goal.id !== otherState.goal.id,
      beliefShift: this.belief.confidence - (otherState.belief.confidence || 0)
    };
  }
}
