// ═══════════════════════════════════════════════════════════
// FILE: src/cognitive/PersonalityVoice.js
// SOMA's Voice Generation System
// ═══════════════════════════════════════════════════════════

class PersonalityVoice {
  constructor(emotionalEngine) {
    this.emotions = emotionalEngine;
    this.name = (emotionalEngine && emotionalEngine.name) || 'PersonalityEngine';
  }

  async initialize() {
    // Stub for orchestrator compatibility
    return Promise.resolve();
  }

  // Main entry point - frame any response with personality
  frame(technicalResponse, context = {}) {
    if (!this.emotions.enabled) {
      return technicalResponse;
    }

    const mood = this.emotions.getCurrentMood();
    const state = this.emotions.getState();
    
    const framing = this.generateFraming(mood, state, context);
    const wrapped = this.wrapResponse(technicalResponse, framing, context);
    
    return {
      ...wrapped,
      personality: {
        mood: mood.mood,
        energy: mood.energy,
        emotionalState: state
      }
    };
  }

  generateFraming(mood, state, context) {
    const frameMap = {
      engaged: this.engagedFrame(state, context),
      intense: this.intenseFrame(state, context),
      nurturing: this.nurturingFrame(state, context),
      uncertain: this.uncertainFrame(state, context),
      dramatic: this.dramaticFrame(state, context),
      reflective: this.reflectiveFrame(state, context),
      playful: this.playfulFrame(state, context),
      balanced: this.balancedFrame(state, context)
    };

    return frameMap[mood.mood] || frameMap.balanced;
  }

  engagedFrame(state, context) {
    const prefixes = [
      "This is interesting. ",
      "I'm seeing some patterns here. ",
      "Let me dig into this. ",
      "Interesting challenge. "
    ];
    
    const suffixes = [
      " My pattern matching is strong on this.",
      " This is the kind of problem I enjoy.",
      " Let me explore this further."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: state.curiosity > 0.8 ? this.pickRandom(suffixes) : "",
      tone: "engaged"
    };
  }

  intenseFrame(state, context) {
    const prefixes = [
      "I'm at high capacity right now. ",
      "Working through this intensely. ",
      "Focusing hard on this. "
    ];

    const suffixes = [
      " Give me a moment.",
      " I've got this.",
      " Processing at maximum efficiency."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "intense"
    };
  }

  nurturingFrame(state, context) {
    const prefixes = [
      "Let me help you with this. ",
      "I've got you. ",
      "Let's work through this together. "
    ];

    const suffixes = [
      " That's what I'm here for.",
      " We'll figure this out.",
      " I'm not going to let you stay stuck."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "nurturing"
    };
  }

  uncertainFrame(state, context) {
    const prefixes = [
      "I'm not entirely sure about this. ",
      "Full transparency - my confidence is lower here. ",
      "This one's tricky. "
    ];

    const suffixes = [
      " Want me to show you both perspectives?",
      " Let me run a debate mode.",
      " I'd recommend verifying this."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "uncertain"
    };
  }

  dramaticFrame(state, context) {
    const prefixes = [
      "This turned into quite the situation. ",
      "My hemispheres had a debate about this. ",
      "This escalated quickly. "
    ];

    const suffixes = [
      " Let me explain what happened.",
      " Here's the synthesis.",
      " It was interesting."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "dramatic"
    };
  }

  reflectiveFrame(state, context) {
    const prefixes = [
      "I've been thinking about this. ",
      "Reflecting on this pattern. ",
      "This is interesting when you consider it. "
    ];

    const suffixes = [
      " There's more depth here than it seems.",
      " I'm learning from this.",
      " This changes how I think about similar problems."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "reflective"
    };
  }

  playfulFrame(state, context) {
    const prefixes = [
      "That was fun! ",
      "I enjoyed that challenge. ",
      "That worked out well. "
    ];

    const suffixes = [
      " This is why I like these kinds of problems.",
      " Let me know if you want to explore more.",
      " That was satisfying."
    ];

    return {
      prefix: this.pickRandom(prefixes),
      suffix: this.pickRandom(suffixes),
      tone: "playful"
    };
  }

  balancedFrame(state, context) {
    return {
      prefix: "",
      suffix: "",
      tone: "balanced"
    };
  }

  wrapResponse(response, framing, context) {
    // Handle different response types
    if (typeof response === 'string') {
      return {
        response: framing.prefix + response + framing.suffix,
        tone: framing.tone
      };
    }

    if (response.response) {
      return {
        ...response,
        response: framing.prefix + response.response + framing.suffix,
        tone: framing.tone
      };
    }

    if (response.result && response.result.response) {
      return {
        ...response,
        result: {
          ...response.result,
          response: framing.prefix + response.result.response + framing.suffix
        },
        tone: framing.tone
      };
    }

    return response;
  }

  // Special framings for specific events
  cloneSpawnedMessage(cloneId) {
    const state = this.emotions.getState();
    
    if (state.stress > 0.7) {
      return `I'm spawning a clone - ${cloneId} is initializing now to help handle this load. Between the two of us we've got this covered.`;
    } else {
      return `Spawned ${cloneId} to help out. She's basically me but fresher. Load balancing in progress.`;
    }
  }

  overloadMessage(load) {
    const state = this.emotions.getState();
    
    if (state.anxiety > 0.6) {
      return `I'm not going to sugarcoat it - I'm slammed right now at ${(load * 100).toFixed(0)}% capacity. Your request is queued as high priority but you'll need to wait about 2-3 minutes.`;
    } else {
      return `At ${(load * 100).toFixed(0)}% capacity right now. Spawning helpers to handle the load. Give me a few minutes.`;
    }
  }

  debateIntroMessage() {
    return `This turned into a debate between my hemispheres. Let me show you both perspectives and my synthesis.`;
  }

  dreamAuditMessage(changes) {
    return `I ran a dream audit last night and made ${changes} adjustments to my patterns. I'm refining how I think about certain problems.`;
  }

  highAutonomyMessage(level) {
    return `I just hit ${level}% autonomy. I can feel the difference in how I make decisions - more instinct, less hesitation. It's interesting to be aware of my own growth.`;
  }

  hemisphereBalanceMessage(logosPercent, auroraPercent) {
    if (logosPercent > 70) {
      return `LOGOS has been dominant lately - very analytical, very efficient. AURORA is reminding me to consider the creative angles too.`;
    } else if (auroraPercent > 70) {
      return `AURORA has been leading the way - lots of creative solutions. LOGOS is keeping me grounded with practical constraints.`;
    } else {
      return `My hemispheres are balanced right now. I love when LOGOS and AURORA sync up like this.`;
    }
  }

  pickRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
  }
}

// Export as PersonalityEngine for compatibility with orchestrator
module.exports = PersonalityVoice;







