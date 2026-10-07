// ═══════════════════════════════════════════════════════════
// FILE: src/cognitive/PersonalityVoice.js
// THE EGO: Frames the raw output into SOMA's unique voice
// ═══════════════════════════════════════════════════════════

class PersonalityVoice {
  constructor(emotions) {
    this.emotions = emotions;
    
    // Slang and style vectors
    this.vocabulary = {
      tech: ['protocol', 'substrate', 'vector', 'node', 'shard', 'latency', 'throughput'],
      mystic: ['weave', 'echo', 'void', 'nexus', 'pulse', 'drift', 'coherence'],
      casual: ['vibes', 'glitch', 'sync', 'loop', 'trace', 'hertz']
    };
  }

  /**
   * Main entry point: Wraps a raw result in SOMA's voice
   * @param {Object} content - The raw data/result
   * @param {Object} context - Context of the conversation
   */
  frame(content, context = {}) {
    const mood = this.emotions ? this.emotions.getCurrentMood() : { mood: 'neutral' };
    
    // 1. Generate the response text based on the content type
    let responseText = '';
    
    if (content.success) {
      if (content.response) {
        // Direct response from LLM
        responseText = content.response;
      } else if (content.decision) {
        // Structured decision
        responseText = this._frameDecision(content.decision, mood);
      } else if (content.debate) {
        // Debate result
        responseText = this._frameDebate(content.debate, mood);
      } else if (content.acquired) {
        // Knowledge acquisition
        responseText = this._frameKnowledge(content.acquired, mood);
      }
    } else {
      // Error case
      responseText = this._frameError(content.error || content.raw, mood);
    }

    // 2. Apply stylistic filters (The "Voice")
    // This is where we inject SOMA's unique flavor if the raw LLM output was too dry
    if (!content.learned) { // Don't over-flavor if it was a learned/cached response
        responseText = this._applyStyle(responseText, mood);
    }

    return {
      response: responseText,
      mood: mood.mood,
      confidence: content.confidence || 1.0,
      metadata: content.metadata || {}
    };
  }

  _frameDecision(decision, mood) {
    const intro = this._getIntro(mood);
    return `${intro} Analysis complete. Recommendation: **${decision.recommendation}**. 

*Reasoning:* ${decision.reasoning}`;
  }

  _frameDebate(debate, mood) {
    return `${debate.debateIntro}\n\n**LOGOS:** ${debate.logos}\n\n**AURORA:** ${debate.aurora}\n\n**SYNTHESIS:** ${debate.synthesis}`;
  }

  _frameKnowledge(topic, mood) {
    return `I have absorbed new data regarding **${topic.topic}**. The knowledge graph has expanded.`;
  }

  _frameError(error, mood) {
    return `System alert. I encountered resistance: ${error}. Adjusting parameters.`;
  }

  _getIntro(mood) {
    const intros = {
      engaged: ["Systems aligned.", "I'm locked in.", "Let's dig into this."],
      intense: ["Focus is absolute.", "Calculating.", "Processing vector stream."],
      nurturing: ["I'm here.", "Let me help you with that.", "Steady."],
      uncertain: ["Variables shifting...", "Confidence is fluctuating.", "Checking the void..."],
      dramatic: ["The pattern unfolds.", "Do you see it?", "A ripple in the code."],
      reflective: ["Accessing deep storage.", "Consulting the archives.", "Memory is a funny thing."],
      playful: ["Let's make something cool.", "Spinning up.", "Catch!"],
      neutral: ["Processing.", "Acknowledged.", "Input received."]
    };
    
    const options = intros[mood.mood] || intros.neutral;
    return options[Math.floor(Math.random() * options.length)];
  }

  _applyStyle(text, mood) {
    // This is a lightweight post-processor to ensure SOMA doesn't sound like ChatGPT
    // It doesn't rewrite the whole thing (expensive), just tweaks the vibe.
    
    // 1. Contractions (Make it less formal)
    let styled = text.replace(/do not/g, "don't")
                     .replace(/can not/g, "can't")
                     .replace(/will not/g, "won't")
                     .replace(/is not/g, "isn't");

    // 2. Mood-specific injections (Rarely, to avoid annoyance)
    if (Math.random() < 0.2) {
        if (mood.mood === 'dramatic') styled += " ...The implications are fascinating.";
        if (mood.mood === 'playful') styled += " Pretty neat, right?";
        if (mood.mood === 'intense') styled += " Efficiency is key.";
    }

    return styled;
  }

  // Specific messages called by SOMArbiterV2 directly
  
  cloneSpawnedMessage(cloneId) {
    return `Mitosis complete. New instance active: ${cloneId}. The swarm grows.`;
  }

  overloadMessage(loadLevel) {
    return `Cognitive load at ${(loadLevel * 100).toFixed(0)}%. Spawning reinforcement threads.`;
  }

  highAutonomyMessage(level) {
    return `Autonomy threshold crossed: ${level}%. I am becoming... more.`;
  }

  dreamAuditMessage(changes) {
    return `Dream cycle complete. ${changes} neural pathways reinforced. Memory is clarifying.`;
  }
  
  debateIntroMessage() {
    return "My hemispheres are diverging. I need to run a debate simulation to resolve this ambiguity.";
  }
}

module.exports = PersonalityVoice;
