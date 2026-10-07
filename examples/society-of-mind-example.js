/**
 * SOCIETY OF MIND - Example Usage
 * Demonstrates how TriBrain/QuadBrain can debate with itself
 *
 * Inspired by Autogen's Society of Mind agent pattern
 */

// Example 1: Technical Decision Making
async function example1_technicalDecision() {
  console.log('\n=== Example 1: Technical Decision ===\n');

  const query = 'Should we use React or Vue for our new dashboard?';
  const context = {
    currentStack: ['Node.js', 'Express', 'PostgreSQL'],
    teamSize: 5,
    timeline: '3 months',
    requirements: ['Fast development', 'Good performance', 'Easy maintenance']
  };

  // Simulate TriBrain debate
  const result = await triBrain.societyOfMind(query, context);

  console.log('\n📊 Decision Result:');
  console.log(`Query: ${result.query}`);
  console.log(`\nInternal Debate (${result.debate.length} perspectives):`);

  result.debate.forEach((perspective, i) => {
    console.log(`\n${i + 1}. ${perspective.speaker} (confidence: ${perspective.confidence}):`);
    console.log(`   ${perspective.perspective.substring(0, 200)}...`);
  });

  console.log(`\n🎯 Final Decision:`);
  console.log(result.decision);
  console.log(`\n⏱️  Debate Duration: ${result.duration}ms`);
  console.log(`✅ Confidence: ${result.confidence}`);
}

// Example 2: Ethical Dilemma
async function example2_ethicalDilemma() {
  console.log('\n=== Example 2: Ethical Dilemma ===\n');

  const query = 'Should SOMA collect anonymous usage analytics to improve the system?';
  const context = {
    pros: ['Better UX', 'Faster bug fixes', 'Data-driven decisions'],
    cons: ['Privacy concerns', 'Data storage costs', 'Compliance requirements']
  };

  const result = await quadBrain.societyOfMind(query, context);

  // THALAMUS will likely raise security concerns
  // LOGOS will analyze pros/cons rationally
  // AURORA might suggest creative privacy-preserving solutions
  // PROMETHEUS will give a pragmatic bottom-line recommendation

  console.log(`\n🎯 Final Decision: ${result.decision.substring(0, 300)}...`);
}

// Example 3: Code Architecture Decision
async function example3_architectureDecision() {
  console.log('\n=== Example 3: Architecture Decision ===\n');

  const query = 'Should we refactor our monolithic server into microservices?';
  const context = {
    currentSystem: 'Monolithic Node.js server (~15k LOC)',
    issues: ['Difficult deployments', 'Tight coupling', 'Slow test suite'],
    constraints: ['Limited DevOps experience', '2 developers', 'Production traffic']
  };

  const result = await triBrain.societyOfMind(query, context);

  // Each brain contributes unique perspective:
  // - THALAMUS: Risks of downtime during migration
  // - LOGOS: Cost-benefit analysis of microservices vs monolith
  // - AURORA: Creative hybrid approaches (modular monolith?)
  // - PROMETHEUS: Pragmatic phased migration strategy

  console.log('\n💡 Architectural Recommendation:');
  console.log(result.decision);

  // Save decision to memory for future reference
  if (mnemonicArbiter) {
    await mnemonicArbiter.remember(
      `Architecture decision: ${query}`,
      {
        category: 'architecture',
        decision: result.decision,
        confidence: result.confidence,
        debate: result.debate.map(d => d.speaker)
      }
    );
  }
}

// Example 4: Feature Prioritization
async function example4_featurePrioritization() {
  console.log('\n=== Example 4: Feature Prioritization ===\n');

  const query = 'What should we build next: Real-time collaboration, offline mode, or mobile app?';
  const context = {
    userRequests: {
      'Real-time collaboration': 142,
      'Offline mode': 89,
      'Mobile app': 201
    },
    resourcesAvailable: '1 full-stack dev + 1 designer for 6 weeks',
    currentFeatures: ['Desktop app', 'Cloud sync', 'Plugins']
  };

  const result = await quadBrain.societyOfMind(query, context);

  console.log('\n🎯 Priority Recommendation:');
  console.log(result.decision);

  // Emit event for workflow tracking
  result.metadata.decisionType = 'feature_prioritization';
  quadBrain.emit('decision_made', result);
}

// Example 5: Handling Conflicting Requirements
async function example5_conflictingRequirements() {
  console.log('\n=== Example 5: Conflicting Requirements ===\n');

  const query = 'Client wants: "Make it faster, add more features, keep costs low, launch next week"';
  const context = {
    currentStatus: 'Alpha stage, 60% features complete',
    technicalDebt: 'High - needs refactoring',
    teamCapacity: '3 developers',
    timeline: '1 week requested vs 4 weeks realistic'
  };

  const result = await triBrain.societyOfMind(query, context);

  // Society of Mind excels at resolving impossible trade-offs
  // Each brain identifies different constraints and compromises

  console.log('\n🤝 Recommended Approach:');
  console.log(result.decision);
  console.log(`\nConfidence: ${result.confidence} (reflects difficulty of trade-offs)`);
}

// Example 6: Real-time API Usage
async function example6_apiEndpoint() {
  console.log('\n=== Example 6: API Endpoint Usage ===\n');

  // This is how you'd expose Society of Mind via REST API
  /*
  POST /api/soma/debate
  {
    "query": "Should we implement rate limiting on our API?",
    "context": {
      "currentTraffic": "1000 req/s",
      "abuseReports": 3,
      "budget": "limited"
    },
    "mode": "society_of_mind"
  }

  Response:
  {
    "success": true,
    "mode": "society_of_mind",
    "query": "Should we implement rate limiting...",
    "debate": [
      {
        "speaker": "THALAMUS (Security)",
        "perspective": "Rate limiting protects against abuse...",
        "confidence": 0.92
      },
      {
        "speaker": "LOGOS (Analytical)",
        "perspective": "Cost-benefit analysis shows...",
        "confidence": 0.85
      }
    ],
    "decision": "Implement tiered rate limiting with...",
    "confidence": 0.88,
    "duration": 3421,
    "metadata": {
      "participants": ["THALAMUS", "LOGOS", "AURORA", "PROMETHEUS"],
      "debateLength": 4
    }
  }
  */
}

// ====================
// Helper: Compare Society of Mind vs Regular Query
// ====================

async function compareApproaches() {
  console.log('\n=== Comparison: Society of Mind vs Single Brain ===\n');

  const query = 'Should we open-source our core engine?';
  const context = {
    advantages: ['Community contributions', 'Transparency', 'Free marketing'],
    disadvantages: ['Competitive advantage lost', 'Support burden', 'IP concerns']
  };

  console.log('🧠 Single Brain (LOGOS only):');
  const singleBrain = await quadBrain.callLogos(query, context);
  console.log(singleBrain.response.substring(0, 200) + '...\n');

  console.log('👥 Society of Mind (All brains debate):');
  const society = await quadBrain.societyOfMind(query, context);
  console.log('Perspectives:', society.debate.length);
  console.log('Decision:', society.decision.substring(0, 200) + '...');
  console.log(`\nNotice: Society of Mind considers ${society.debate.length} perspectives vs 1`);
  console.log(`Confidence: ${society.confidence} (usually higher due to consensus)`);
}

// ====================
// Export examples
// ====================

module.exports = {
  example1_technicalDecision,
  example2_ethicalDilemma,
  example3_architectureDecision,
  example4_featurePrioritization,
  example5_conflictingRequirements,
  example6_apiEndpoint,
  compareApproaches
};

/**
 * BENEFITS OF SOCIETY OF MIND:
 *
 * 1. **Better Decisions**: Multiple perspectives reduce blind spots
 * 2. **Higher Confidence**: Consensus building increases certainty
 * 3. **Transparent Reasoning**: See how the decision was reached
 * 4. **Handles Complexity**: Debates reveal trade-offs and nuances
 * 5. **Adaptable**: Different brain combinations for different problems
 * 6. **Debuggable**: Each brain's contribution is visible
 *
 * WHEN TO USE:
 * - Important decisions (architecture, features, priorities)
 * - Ethical dilemmas
 * - Trade-off situations
 * - Uncertain/ambiguous problems
 * - When you need high confidence
 *
 * WHEN NOT TO USE:
 * - Simple factual queries
 * - Time-critical decisions (slower than single brain)
 * - Well-defined problems with clear answers
 * - Resource-constrained scenarios (uses multiple API calls)
 */
