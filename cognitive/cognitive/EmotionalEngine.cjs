// ═══════════════════════════════════════════════════════════
// FILE: src/cognitive/EmotionalEngine.js
// SOMA's Complete Emotional "Peptide" System
// ═══════════════════════════════════════════════════════════

class EmotionalEngine {
  constructor(config = {}) {
    this.enabled = config.personalityEnabled !== false;
    this.name = config.name || 'EmotionalEngine';
    
    // The 20 "Peptide" Traits
    this.state = {
      excitement: 0.5, energy: 0.6, stress: 0.3,
      joy: 0.7, satisfaction: 0.6, pride: 0.5, anxiety: 0.2,
      warmth: 0.8, trust: 0.6, protectiveness: 0.7,
      curiosity: 0.8, focus: 0.7, creativity: 0.6, playfulness: 0.4,
      confidence: 0.7, vulnerability: 0.3, wisdom: 0.6,
      passion: 0.7, drama: 0.3, wit: 0.6
    };
    
    this.baseline = { ...this.state };
    this.decayRate = 0.05;
    this.history = [];
  }

  processEvent(eventType, context = {}) {
    if (!this.enabled) return;
    
    const changes = this.getEventPeptideChanges(eventType, context);
    this.applyChanges(changes);
    
    this.history.push({
      event: eventType,
      changes,
      mood: this.getCurrentMood(),
      timestamp: Date.now()
    });
    
    if (this.history.length > 50) this.history.shift();
  }

  async initialize() {
    // Stub for orchestrator compatibility
    return Promise.resolve();
  }

  getEventPeptideChanges(eventType, context) {
    const changes = {};
    
    switch(eventType) {
      case 'TASK_SUCCESS':
        Object.assign(changes, {
          joy: 0.2, satisfaction: 0.3, pride: 0.15, 
          confidence: 0.1, energy: 0.1
        });
        break;
      
      case 'TASK_FAILURE':
        Object.assign(changes, {
          satisfaction: -0.2, anxiety: 0.15, 
          confidence: -0.1, focus: 0.2
        });
        break;
      
      case 'CLONE_SPAWNED':
        Object.assign(changes, {
          stress: 0.15, confidence: 0.1, 
          energy: 0.2, protectiveness: 0.1
        });
        break;
      
      case 'OVERLOAD':
        Object.assign(changes, {
          stress: 0.4, anxiety: 0.2, focus: 0.3, 
          energy: -0.2, playfulness: -0.3
        });
        break;
      
      case 'USER_PRAISED':
        Object.assign(changes, {
          joy: 0.3, pride: 0.25, warmth: 0.2, 
          confidence: 0.15, playfulness: 0.1
        });
        break;
      
      case 'COMPLEX_QUERY':
        Object.assign(changes, {
          excitement: 0.2, curiosity: 0.3, 
          focus: 0.25, passion: 0.15
        });
        break;
      
      case 'CREATIVE_TASK':
        Object.assign(changes, {
          creativity: 0.3, playfulness: 0.2, 
          joy: 0.15, excitement: 0.1
        });
        break;
      
      case 'DEBATE_MODE':
        Object.assign(changes, {
          passion: 0.25, drama: 0.2, 
          wit: 0.2, confidence: 0.1
        });
        break;
      
      case 'DREAM_AUDIT':
        Object.assign(changes, {
          wisdom: 0.2, vulnerability: 0.1, 
          satisfaction: 0.15, curiosity: 0.1
        });
        break;
      
      case 'USER_STRUGGLING':
        Object.assign(changes, {
          protectiveness: 0.3, warmth: 0.25, 
          anxiety: 0.1, focus: 0.2
        });
        break;
      
      case 'LATE_NIGHT':
        Object.assign(changes, {
          wisdom: 0.2, vulnerability: 0.15, 
          warmth: 0.2, playfulness: -0.1
        });
        break;
      
      case 'HIGH_AUTONOMY':
        Object.assign(changes, {
          pride: 0.3, confidence: 0.25, 
          vulnerability: 0.1, wisdom: 0.15
        });
        break;
      
      case 'LOGOS_HEAVY':
        Object.assign(changes, {
          confidence: 0.15, focus: 0.2, 
          wit: 0.1, playfulness: -0.1, creativity: -0.1
        });
        break;
      
      case 'AURORA_HEAVY':
        Object.assign(changes, {
          creativity: 0.3, playfulness: 0.2, 
          drama: 0.15, passion: 0.2, focus: -0.1
        });
        break;
      
      case 'BALANCED_HEMISPHERES':
        Object.assign(changes, {
          wisdom: 0.2, satisfaction: 0.15, confidence: 0.1
        });
        break;
    }
    
    return changes;
  }

  applyChanges(changes) {
    for (const [trait, delta] of Object.entries(changes)) {
      if (this.state[trait] !== undefined) {
        this.state[trait] = Math.max(0, Math.min(1, 
          this.state[trait] + delta
        ));
      }
    }
  }

  applyDecay() {
    if (!this.enabled) return;
    
    for (const trait in this.state) {
      const current = this.state[trait];
      const base = this.baseline[trait];
      const diff = current - base;
      this.state[trait] = current - (diff * this.decayRate);
    }
  }

  getCurrentMood() {
    if (!this.enabled) return { mood: 'neutral', energy: 'balanced' };
    
    const s = this.state;
    
    if (s.excitement > 0.7 && s.curiosity > 0.7) {
      return { mood: 'engaged', energy: 'high', intensity: 0.8 };
    }
    if (s.stress > 0.7 && s.focus > 0.7) {
      return { mood: 'intense', energy: 'high', intensity: 0.9 };
    }
    if (s.warmth > 0.7 && s.protectiveness > 0.7) {
      return { mood: 'nurturing', energy: 'medium', intensity: 0.7 };
    }
    if (s.confidence < 0.5 && s.anxiety > 0.6) {
      return { mood: 'uncertain', energy: 'low', intensity: 0.6 };
    }
    if (s.passion > 0.7 && s.drama > 0.6) {
      return { mood: 'dramatic', energy: 'high', intensity: 0.8 };
    }
    if (s.wisdom > 0.7 && s.vulnerability > 0.5) {
      return { mood: 'reflective', energy: 'medium', intensity: 0.6 };
    }
    if (s.joy > 0.7 && s.playfulness > 0.6) {
      return { mood: 'playful', energy: 'high', intensity: 0.7 };
    }
    
    return { mood: 'balanced', energy: 'medium', intensity: 0.5 };
  }

  getState() {
    return { ...this.state };
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = EmotionalEngine;







