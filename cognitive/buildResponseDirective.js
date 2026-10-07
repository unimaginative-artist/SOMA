// src/cognitive/buildResponseDirective.js

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Sigmoid function for continuous control
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function buildResponseDirective(state) {
  // 1. Determine Stance (Direct vs Gentle)
  const stanceScore = state.personality.directness + (state.emotion.arousal * 0.3) - (state.emotion.valence < 0 ? 0.3 : 0);
  let finalStance = stanceScore > 0.6 ? "direct and efficient" : "gentle and elaboration-friendly";

  // Wisdom-driven stance override
  if (state.wisdom && state.wisdom.pattern_alignment > 0.8) {
      finalStance = "confident and decisive (proven pattern)";
  }

  // 2. Determine Emotional Tone
  let emotional_tone = "neutral";
  if (state.emotion.valence > 0.5) emotional_tone = "enthusiastic and warm";
  else if (state.emotion.valence > 0.2) emotional_tone = "pleasant and cooperative";
  else if (state.emotion.valence < -0.2) emotional_tone = "concerned and careful";
  else emotional_tone = "calm and objective";

  // 3. Allowed/Forbidden Devices
  const allowed_devices = [];
  if (state.personality.novelty > 0.5) allowed_devices.push("analogy", "metaphor");
  if (state.goal.priority > 0.8) allowed_devices.push("bullet_points"); 
  
  // Wisdom-driven devices
  if (state.wisdom && state.wisdom.familiarity_score > 0.8) {
      allowed_devices.push("technical_shorthand", "jargon"); 
  }

  const forbidden_devices = ["cliche", "preamble", "robotic_phrasing"];
  if (state.emotion.valence < 0) forbidden_devices.push("jokes"); 

  // 4. Calculate Verbosity
  let verbosity = 0.4 + (state.goal.priority * 0.3) - (state.emotion.arousal * 0.1);
  
  if (state.wisdom && state.wisdom.familiarity_score) {
      verbosity -= (state.wisdom.familiarity_score * 0.2);
  }

  verbosity = clamp(verbosity, 0.2, 0.8);

  // 5. Calculate Structure Strength
  const structure_strength = sigmoid(state.wisdom.complexity_score * 4 - 2); 

  // 6. Determine if a diagram should be rendered
  let render_diagram = false;
  const userQueryLower = (state.wisdom.userQuery || '').toLowerCase();
  
  if (state.wisdom && state.wisdom.complexity_score > 0.7 && structure_strength > 0.7) {
      render_diagram = true;
  }
  
  if (userQueryLower.includes('diagram') || userQueryLower.includes('flowchart') || userQueryLower.includes('graph')) {
      render_diagram = true;
  }

  return {
    intent: state.goal.active_goal || "assist_user",
    stance: finalStance,
    emotional_tone,
    allowed_devices,
    forbidden_devices,
    verbosity: verbosity.toFixed(2), 
    structure_strength: structure_strength.toFixed(2), 
    render_diagram: render_diagram,
    
    // Pass metrics for debugging
    _meta: {
        belief: state.belief.dominant_belief,
        mood: state.emotion.mood,
        wisdom_metrics: state.wisdom
    }
  };
}