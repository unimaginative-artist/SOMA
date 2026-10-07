#!/usr/bin/env node
/**
 * review-proposals.mjs
 *
 * Interactive tool to review SOMA's improvement proposals.
 * Shows what SOMA thinks, and lets you approve/reject her ideas.
 *
 * Usage: node review-proposals.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';

const PROPOSALS_PATH = path.join(process.cwd(), '.soma', 'fix-proposals');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function loadProposals() {
  try {
    const files = await fs.readdir(PROPOSALS_PATH);
    const proposalFiles = files.filter(f => f.startsWith('proposal-') && f.endsWith('.json'));

    const proposals = [];
    for (const file of proposalFiles) {
      const filepath = path.join(PROPOSALS_PATH, file);
      const content = await fs.readFile(filepath, 'utf8');
      const proposal = JSON.parse(content);
      proposals.push(proposal);
    }

    return proposals;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No proposals directory found. Run SOMA first to generate proposals.');
      return [];
    }
    throw error;
  }
}

async function saveProposal(proposal) {
  const filename = `proposal-${proposal.id}.json`;
  const filepath = path.join(PROPOSALS_PATH, filename);
  await fs.writeFile(filepath, JSON.stringify(proposal, null, 2), 'utf8');
}

function formatProposal(proposal, index) {
  const lines = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push(`  PROPOSAL #${index + 1}`);
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  lines.push(`📋 ${proposal.proposal.title}`);
  lines.push(`   File: ${proposal.opportunity.file}`);
  lines.push(`   Type: ${proposal.opportunity.type}`);
  lines.push(`   Severity: ${proposal.opportunity.severity}`);
  lines.push('');

  lines.push(`📊 Assessment:`);
  lines.push(`   Confidence: ${(proposal.proposal.confidence * 100).toFixed(0)}%`);
  lines.push(`   Risk: ${proposal.proposal.risk.toUpperCase()}`);
  lines.push(`   Status: ${proposal.status.toUpperCase()}`);
  lines.push(`   Safety Approved: ${proposal.proposal.safetyApproved ? '✅ YES' : '❌ NO'}`);
  lines.push('');

  lines.push(`🔍 What SOMA Observed:`);
  lines.push(`   ${proposal.opportunity.message}`);
  lines.push('');

  lines.push(`💡 SOMA's Proposal:`);
  lines.push(`   ${proposal.opportunity.currentSuggestion}`);
  lines.push('');

  lines.push(`🧠 QuadBrain Analysis:`);
  lines.push('');
  lines.push(`   💭 LOGOS (Analytical):`);
  lines.push(`   ${proposal.proposal.reasoning.logos}`);
  lines.push('');
  lines.push(`   🎨 AURORA (Creative):`);
  lines.push(`   ${proposal.proposal.reasoning.aurora}`);
  lines.push('');
  lines.push(`   📍 PROMETHEUS (Strategic):`);
  lines.push(`   ${proposal.proposal.reasoning.prometheus}`);
  lines.push('');
  lines.push(`   🛡️  THALAMUS (Safety):`);
  lines.push(`   ${proposal.proposal.reasoning.thalamus}`);
  lines.push('');

  if (proposal.proposal.fix.beforeAfter) {
    lines.push(`📝 Before/After:`);
    lines.push(`   Before: ${proposal.proposal.fix.beforeAfter.before}`);
    lines.push(`   After:  ${proposal.proposal.fix.beforeAfter.after}`);
    lines.push('');
  }

  lines.push(`📅 Generated: ${new Date(proposal.timestamp).toLocaleString()}`);
  lines.push(`🆔 ID: ${proposal.id}`);
  lines.push('');

  return lines.join('\n');
}

async function reviewProposal(proposal, index, total) {
  console.clear();
  console.log(formatProposal(proposal, index));

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  REVIEW (${index + 1}/${total})`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (proposal.status !== 'pending') {
    console.log(`⚠️  This proposal is already ${proposal.status.toUpperCase()}`);
    if (proposal.metadata.statusNotes) {
      console.log(`   Notes: ${proposal.metadata.statusNotes}`);
    }
    console.log('');

    const answer = await question('Press Enter to continue, or "r" to re-review: ');
    if (answer.toLowerCase() !== 'r') {
      return;
    }
  }

  console.log('What would you like to do?');
  console.log('  [a] Approve - Good idea, plan to implement');
  console.log('  [r] Reject - Not a good fit');
  console.log('  [s] Skip - Decide later');
  console.log('  [q] Quit review');
  console.log('');

  const answer = await question('Your choice: ');

  switch (answer.toLowerCase()) {
    case 'a':
      const approvalNotes = await question('Add notes (optional): ');
      proposal.status = 'approved';
      proposal.metadata.statusUpdated = Date.now();
      proposal.metadata.statusNotes = approvalNotes || 'Approved for implementation';
      await saveProposal(proposal);
      console.log('✅ Proposal approved!');
      await question('\nPress Enter to continue...');
      break;

    case 'r':
      const rejectionNotes = await question('Reason for rejection (optional): ');
      proposal.status = 'rejected';
      proposal.metadata.statusUpdated = Date.now();
      proposal.metadata.statusNotes = rejectionNotes || 'Rejected';
      await saveProposal(proposal);
      console.log('❌ Proposal rejected');
      await question('\nPress Enter to continue...');
      break;

    case 's':
      console.log('⏭️  Skipped for now');
      await question('\nPress Enter to continue...');
      break;

    case 'q':
      return 'quit';

    default:
      console.log('Invalid choice, skipping...');
      await question('\nPress Enter to continue...');
      break;
  }
}

async function showSummary(proposals) {
  console.clear();
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📊 PROPOSAL SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const pending = proposals.filter(p => p.status === 'pending');
  const approved = proposals.filter(p => p.status === 'approved');
  const rejected = proposals.filter(p => p.status === 'rejected');
  const implemented = proposals.filter(p => p.status === 'implemented');

  console.log(`Total Proposals: ${proposals.length}`);
  console.log(`  Pending:      ${pending.length}`);
  console.log(`  Approved:     ${approved.length}`);
  console.log(`  Rejected:     ${rejected.length}`);
  console.log(`  Implemented:  ${implemented.length}`);
  console.log('');

  if (approved.length > 0) {
    console.log('✅ Approved Proposals:');
    approved.forEach(p => {
      console.log(`   • ${p.proposal.title} (${(p.proposal.confidence * 100).toFixed(0)}%)`);
    });
    console.log('');
  }

  if (pending.length > 0) {
    console.log('⏳ Still Pending:');
    pending.forEach(p => {
      console.log(`   • ${p.proposal.title} (${(p.proposal.confidence * 100).toFixed(0)}%)`);
    });
    console.log('');
  }

  const avgConfidence = proposals.reduce((sum, p) => sum + p.proposal.confidence, 0) / proposals.length;
  console.log(`Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log('');
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  💭 SOMA PROPOSAL REVIEW TOOL');
  console.log('  Review and approve SOMA\'s improvement ideas');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Load proposals
  console.log('Loading proposals...');
  const proposals = await loadProposals();

  if (proposals.length === 0) {
    console.log('No proposals found!');
    console.log('Run SOMA\'s self-observation first to generate proposals.');
    console.log('');
    rl.close();
    return;
  }

  console.log(`Found ${proposals.length} proposals`);
  await question('\nPress Enter to start review...');

  // Review each proposal
  const pending = proposals.filter(p => p.status === 'pending');

  if (pending.length === 0) {
    console.log('\nNo pending proposals to review!');
    await showSummary(proposals);
    rl.close();
    return;
  }

  for (let i = 0; i < pending.length; i++) {
    const result = await reviewProposal(pending[i], i, pending.length);
    if (result === 'quit') {
      break;
    }
  }

  // Show final summary
  const updatedProposals = await loadProposals();
  await showSummary(updatedProposals);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ✨ REVIEW COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps:');
  console.log('  • Approved proposals are ready for implementation');
  console.log('  • Check .soma/fix-proposals/ for details');
  console.log('  • Run SOMA again to generate more proposals');
  console.log('');

  rl.close();
}

main().catch(error => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});
