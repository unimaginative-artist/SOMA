// src/cognitive/gatherCognitiveState.js

import { CognitiveState } from "./CognitiveState.js";
import fs from 'fs';
import path from 'path';

// We inject the arbiters here to keep this pure function testable if needed, 
// or we can import them if they are singletons. Given SOMA's structure, 
// passing instances is safer.

export async function gatherCognitiveState(context, arbiters) {
  const { 
    beliefSystemArbiter, 
    goalPlannerArbiter, 
    emotionalEngine, 
    personalityEngine,
    mnemonicArbiter,
    microAgentManager,
    knowledgeGraph,
    analystArbiter
  } = arbiters;

  const query = context.query || "";

  // 0. Quick Perception (Local/Fast)
  const perception = {
    isTechnical: /code|function|api|error|debug|compile/i.test(query),
    isCreative: /story|write|imagine|design|paint/i.test(query),
    isComplex: query.length > 50
  };

  // 1. Parallel Swarm Gathering
  // Fire off all information retrieval tasks simultaneously
  const swarmPromises = {
    // Memory Retrieval (Fixed signature: pass number 3, not object)
    memory: mnemonicArbiter ? mnemonicArbiter.recall(query, 3) : Promise.resolve([]),
    
    // Pattern Recognition
    patterns: analystArbiter ? analystArbiter.getRelevantPatterns(query) : Promise.resolve([]),
    
    // Knowledge Graph (Semantic Links)
    knowledge: knowledgeGraph ? knowledgeGraph.query(query) : Promise.resolve([]),
    
    // Core Beliefs
    beliefs: beliefSystemArbiter ? Promise.resolve(beliefSystemArbiter.getCoreBeliefs()) : Promise.resolve([]),
    
    // Active Goals
    goals: goalPlannerArbiter ? Promise.resolve(goalPlannerArbiter.getActiveGoals()) : Promise.resolve([])
  };

  // 1.5 Active Micro-Agent Swarm (Optional/Expensive)
  if (microAgentManager && perception.isComplex && perception.isTechnical) {
      // Placeholder for future swarm activation
  }

  // Wait for the swarm to return
  const swarmResults = await Promise.allSettled(Object.values(swarmPromises));
  
  // Extract results safely
  const results = {
    memory: swarmResults[0].status === 'fulfilled' ? swarmResults[0].value : [],
    patterns: swarmResults[1].status === 'fulfilled' ? swarmResults[1].value : [],
    knowledge: swarmResults[2].status === 'fulfilled' ? swarmResults[2].value : [],
    beliefs: swarmResults[3].status === 'fulfilled' ? swarmResults[3].value : [],
    goals: swarmResults[4].status === 'fulfilled' ? swarmResults[4].value : []
  };

  // 2. Synthesize Belief State
  let belief = { id: "neutral", confidence: 0.5, dominant_belief: "open_mindedness" };

  // Try loading evolved dream personality traits first
  const traitsPath = path.join(process.cwd(), '.soma', 'soma-personality-traits.json');
  let evolvedTraits = null;
  try {
    if (fs.existsSync(traitsPath)) {
      evolvedTraits = JSON.parse(fs.readFileSync(traitsPath, 'utf8'));
    }
  } catch (e) {}

  if (evolvedTraits && evolvedTraits.dominant_belief) {
    belief = {
      id: "evolved_values",
      confidence: 0.85,
      dominant_belief: evolvedTraits.dominant_belief
    };
  } else if (results.beliefs && results.beliefs.length > 0) {
    belief = { 
      id: "core_values", 
      confidence: results.beliefs[0].confidence, 
      dominant_belief: results.beliefs[0].statement 
    };
  }

  // 3. Synthesize Goal State
  let goal = { id: "assist", priority: 0.5, active_goal: "help_user" };
  if (results.goals && results.goals.length > 0) {
    const topGoal = results.goals.sort((a,b) => b.priority - a.priority)[0];
    goal = {
      id: topGoal.id,
      priority: topGoal.priority,
      active_goal: topGoal.title
    };
  }

  // 4. Assess Emotion (Fast/Local)
  let emotion = { valence: 0.1, arousal: 0.1, mood: "neutral" };
  if (emotionalEngine) {
    const moodData = emotionalEngine.getCurrentMood(); 
    const state = emotionalEngine.getState(); 
    const valence = (state.joy || 0) + (state.satisfaction || 0) - (state.stress || 0) - (state.anxiety || 0);
    const arousal = (state.excitement || 0) + (state.stress || 0) + (state.energy || 0);

    emotion = {
      valence: Math.max(-1, Math.min(1, valence)),
      arousal: Math.max(0, Math.min(1, arousal)),
      mood: moodData.mood
    };
  }

  // 5. Determine Personality Bias
  let personality = { novelty: 0.5, directness: 0.5, warmth: 0.5 };
  if (evolvedTraits) {
    personality = {
      novelty: evolvedTraits.creativity != null ? evolvedTraits.creativity : 0.5,
      directness: evolvedTraits.directness != null ? evolvedTraits.directness : 0.5,
      warmth: evolvedTraits.warmth != null ? evolvedTraits.warmth : 0.5
    };
  } else if (personalityEngine && personalityEngine.core) {
    personality = {
        novelty: perception.isCreative ? 0.8 : 0.4, 
        directness: perception.isTechnical ? 0.8 : 0.5,
        warmth: 0.7
    };
  }

  // 6. Construct Wisdom (Pure Metrics, No Narrative)
  
  // Calculate Familiarity (Average confidence of top memories)
  let avgMemoryScore = 0;
  if (results.memory && results.memory.results && Array.isArray(results.memory.results)) {
      // MnemonicArbiter recall returns { results: [], tier: ... }
      const mems = results.memory.results;
      if (mems.length > 0) {
          avgMemoryScore = mems.reduce((acc, m) => acc + (m.score || m.similarity || 0), 0) / mems.length;
      }
  } else if (Array.isArray(results.memory) && results.memory.length > 0) {
      // Fallback if it returns array
      avgMemoryScore = results.memory.reduce((acc, m) => acc + (m.score || m.similarity || 0), 0) / results.memory.length;
  }
    
  // Calculate Complexity (Graph density)
  // Handle knowledge graph query result (it's an object with 'related' array)
  const knowledgeCount = results.knowledge && results.knowledge.related 
    ? results.knowledge.related.length 
    : (Array.isArray(results.knowledge) ? results.knowledge.length : 0);
  const graphDensity = knowledgeCount > 0
    ? Math.min(1, knowledgeCount / 5)
    : 0;

  // Calculate Pattern Alignment
  const patternConfidence = results.patterns && results.patterns.length > 0
    ? (results.patterns[0].confidence || 0.5)
    : 0;

  // Handle knowledge graph query result (it's an object, not an array)
  const knowledgeArray = results.knowledge && results.knowledge.related 
    ? results.knowledge.related 
    : (Array.isArray(results.knowledge) ? results.knowledge : []);
  
  const wisdom = {
      familiarity_score: parseFloat(avgMemoryScore.toFixed(2)),
      complexity_score: parseFloat(graphDensity.toFixed(2)),
      pattern_alignment: parseFloat(patternConfidence.toFixed(2)),
      cross_domain_connectivity: knowledgeArray.filter(k => k.type === 'cross-domain').length,
      userQuery: query
  };

  return new CognitiveState({
    belief,
    goal,
    emotion,
    personality,
    wisdom
  });
}
