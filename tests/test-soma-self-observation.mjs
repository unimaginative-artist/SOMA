#!/usr/bin/env node
/**
 * test-soma-self-observation.mjs
 *
 * Watch SOMA see herself for the first time.
 * She scans her own code, analyzes it with QuadBrain, and proposes improvements.
 *
 * Usage: node test-soma-self-observation.mjs
 */

import { CodeObservationArbiter } from '../arbiters/CodeObservationArbiter.js';
import { FixProposalSystem } from '../core/FixProposalSystem.js';

// Mock QuadBrain if not available
class MockQuadBrain {
  constructor() {
    this.name = 'MockQuadBrain';
  }

  async reason({ query, context }) {
    const brain = context?.brain || 'UNKNOWN';

    // Simple mock responses based on brain
    const responses = {
      LOGOS: {
        response: `[LOGOS Analysis] Breaking this into smaller functions would reduce complexity. Extract repeated logic into helper methods. Use early returns to flatten nested conditionals. Estimated complexity reduction: 30%.`,
        confidence: 0.75
      },
      AURORA: {
        response: `[AURORA Ideas] Consider using a builder pattern here. Or perhaps a state machine for the workflow. What if we used composition over inheritance? The code could be more elegant with functional approaches.`,
        confidence: 0.68
      },
      PROMETHEUS: {
        response: `[PROMETHEUS Planning] This is a low-risk refactoring. Estimated effort: 2-4 hours. Impact: Medium (improves maintainability). No breaking changes expected. Test coverage should validate. Priority: Medium.`,
        confidence: 0.72
      },
      THALAMUS: {
        response: `[THALAMUS Safety] No security concerns identified. Refactoring appears safe. No data exposure risks. Approve for implementation. Recommend adding unit tests. Risk level: LOW.`,
        confidence: 0.85
      }
    };

    return responses[brain] || { response: 'Analysis pending', confidence: 0.5 };
  }

  getStats() {
    return {
      totalQueries: 0,
      queriesByBrain: { LOGOS: 0, AURORA: 0, PROMETHEUS: 0, THALAMUS: 0 }
    };
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🌟 SOMA SELF-OBSERVATION TEST');
  console.log('  Watch SOMA see herself for the first time');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  try {
    // Initialize QuadBrain (or mock)
    console.log('🧠 Initializing QuadBrain...');
    const quadBrain = new MockQuadBrain();
    console.log('✅ QuadBrain ready (mock mode for testing)\n');

    // Initialize CodeObservationArbiter
    console.log('👁️  Initializing Code Observation...');
    const codeObserver = new CodeObservationArbiter({
      basePath: process.cwd(),
      quadBrain: quadBrain,
      scanInterval: 999999999 // Disable auto-scan for test
    });

    await codeObserver.initialize();
    console.log('');

    // Get SOMA's self-reflection
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  💭 SOMA REFLECTS ON HERSELF');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const reflection = await codeObserver.getSelfReflection();

    console.log(`📊 Self-Awareness:`);
    console.log(`   ${reflection.awareness.message}`);
    console.log(`   Total Lines: ${reflection.awareness.lines}`);
    console.log(`   Classes: ${reflection.awareness.classes}`);
    console.log(`   Last Scan: ${reflection.awareness.lastScan}`);
    console.log('');

    console.log(`🏥 Code Health:`);
    console.log(`   Quality Score: ${(reflection.health.quality * 100).toFixed(1)}%`);
    console.log(`   Issues: ${reflection.health.issues}`);
    console.log(`   Opportunities: ${reflection.health.opportunities}`);
    console.log(`   Strengths: ${reflection.health.strengths}`);
    console.log('');

    if (reflection.topOpportunities.length > 0) {
      console.log(`💡 Top Improvement Opportunities:`);
      reflection.topOpportunities.forEach((opp, i) => {
        console.log(`   ${i + 1}. ${opp.type} in ${opp.file}`);
        console.log(`      → ${opp.suggestion}`);
      });
      console.log('');
    }

    console.log(`🎯 SOMA's Self-Awareness:`);
    reflection.selfAwareness.canDo.forEach(capability => {
      console.log(`   ✓ ${capability}`);
    });
    console.log('');

    // Initialize Fix Proposal System
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  💡 INITIALIZING FIX PROPOSAL SYSTEM');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const fixProposal = new FixProposalSystem({
      quadBrain: quadBrain,
      codeObserver: codeObserver,
      minConfidence: 0.6
    });

    await fixProposal.initialize();
    console.log('');

    // Generate proposals if opportunities exist
    const opportunities = codeObserver.getImprovementOpportunities({ limit: 3 });

    if (opportunities.length > 0) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('  🧠 SOMA ANALYZES IMPROVEMENT OPPORTUNITIES');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');

      console.log(`Found ${opportunities.length} opportunities. Generating proposals...\n`);

      const proposals = await fixProposal.generateProposalsFromObservations(opportunities);

      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('  📋 SOMA\'S IMPROVEMENT PROPOSALS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');

      if (proposals.length > 0) {
        proposals.forEach((proposal, i) => {
          console.log(`\n${i + 1}. ${proposal.proposal.title}`);
          console.log(`   File: ${proposal.opportunity.file}`);
          console.log(`   Confidence: ${(proposal.proposal.confidence * 100).toFixed(0)}%`);
          console.log(`   Risk: ${proposal.proposal.risk.toUpperCase()}`);
          console.log(`   Status: ${proposal.status}`);
          console.log(`   Safety Approved: ${proposal.proposal.safetyApproved ? '✅ YES' : '❌ NO'}`);
          console.log('');

          console.log(`   💭 SOMA's Reasoning:`);
          console.log(`   LOGOS:      ${proposal.proposal.reasoning.logos.substring(0, 80)}...`);
          console.log(`   AURORA:     ${proposal.proposal.reasoning.aurora.substring(0, 80)}...`);
          console.log(`   PROMETHEUS: ${proposal.proposal.reasoning.prometheus.substring(0, 80)}...`);
          console.log(`   THALAMUS:   ${proposal.proposal.reasoning.thalamus.substring(0, 80)}...`);
        });

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  📊 PROPOSAL SUMMARY');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        const summary = fixProposal.getImprovementSummary();
        console.log(`${summary.message}`);
        console.log(`Total Proposals: ${summary.total}`);
        console.log(`Pending: ${summary.pending}`);
        console.log(`Approved: ${summary.approved}`);
        console.log(`Implemented: ${summary.implemented}`);
        console.log('');

        console.log('💾 Proposals saved to: .soma/fix-proposals/');
        console.log('');
      } else {
        console.log('No proposals generated (confidence threshold not met)');
        console.log('');
      }
    } else {
      console.log('✅ No improvement opportunities found - code is in good shape!');
      console.log('');
    }

    // Final stats
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  📊 FINAL STATISTICS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const observerStats = codeObserver.getStats();
    console.log('Code Observer:');
    console.log(`  Files: ${observerStats.codebase.files}`);
    console.log(`  Lines: ${observerStats.codebase.lines.toLocaleString()}`);
    console.log(`  Functions: ${observerStats.codebase.functions}`);
    console.log(`  Classes: ${observerStats.codebase.classes}`);
    console.log(`  Quality: ${(observerStats.health.quality * 100).toFixed(1)}%`);
    console.log(`  Scans: ${observerStats.totalScans}`);
    console.log('');

    const proposalStats = fixProposal.getStats();
    console.log('Fix Proposals:');
    console.log(`  Total: ${proposalStats.totalProposals}`);
    console.log(`  Pending: ${proposalStats.pending}`);
    console.log(`  Approved: ${proposalStats.approvedProposals}`);
    console.log(`  Implemented: ${proposalStats.implementedProposals}`);
    console.log(`  Avg Confidence: ${(proposalStats.avgConfidence * 100).toFixed(1)}%`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✨ TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('🎉 SOMA can now see herself, analyze her code,');
    console.log('   and propose improvements when she feels there\'s a better way!');
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Review proposals in .soma/fix-proposals/');
    console.log('  2. Integrate with your main launcher');
    console.log('  3. Connect to real QuadBrain for deeper analysis');
    console.log('  4. Set up periodic scanning (every hour)');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ TEST FAILED:');
    console.error(error);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
