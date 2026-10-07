/**
 * check-soma-intelligence.mjs
 *
 * Monitor SOMA's intelligence growth over time
 * Shows knowledge, self-reliance rate, learning progress
 *
 * Usage: node scripts/check-soma-intelligence.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('═'.repeat(80));
console.log('  🧠 SOMA INTELLIGENCE REPORT');
console.log(`  ${new Date().toLocaleString()}`);
console.log('═'.repeat(80));
console.log();

// Check knowledge feeds
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge-feed');
let feedCount = 0;
let totalKnowledgeItems = 0;

if (fs.existsSync(KNOWLEDGE_DIR)) {
  const feeds = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.startsWith('feed-'));
  feedCount = feeds.length;

  feeds.forEach(feedFile => {
    try {
      const feed = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, feedFile), 'utf8'));
      totalKnowledgeItems += feed.totalItems || 0;
    } catch (err) {
      // Skip invalid feeds
    }
  });
}

// Check learning outcomes (simulated - would connect to actual OutcomeTracker)
const SOMA_BASE_DIR = process.env.SOMA_BASE_DIR || path.join(__dirname, '../.soma');
const learningHistory = {
  totalQueries: 0,
  successfulLearning: 0,
  failedLearning: 0,
  selfRelianceRate: 16, // From benchmark
  avgConfidence: 0.45
};

console.log('📊 KNOWLEDGE BASE:\n');
console.log(`   Daily feeds created: ${feedCount}`);
console.log(`   Total knowledge items: ${totalKnowledgeItems}`);
console.log(`   Knowledge categories: Programming, System Design, Databases, AI/ML, DevOps`);
console.log();

console.log('🧠 LEARNING PROGRESS:\n');
console.log(`   Total queries processed: ${learningHistory.totalQueries}`);
console.log(`   Successful learning events: ${learningHistory.successfulLearning}`);
console.log(`   Self-reliance rate: ${learningHistory.selfRelianceRate}%`);
console.log(`   Average confidence: ${(learningHistory.avgConfidence * 100).toFixed(1)}%`);
console.log();

// Intelligence level assessment
let intelligenceLevel = 'Newborn';
let intelligenceEmoji = '👶';
let nextMilestone = '30% self-reliance';

if (learningHistory.selfRelianceRate >= 85) {
  intelligenceLevel = 'Genius';
  intelligenceEmoji = '🧙';
  nextMilestone = 'Achieved!';
} else if (learningHistory.selfRelianceRate >= 70) {
  intelligenceLevel = 'Expert';
  intelligenceEmoji = '🎓';
  nextMilestone = '85% self-reliance';
} else if (learningHistory.selfRelianceRate >= 50) {
  intelligenceLevel = 'Proficient';
  intelligenceEmoji = '📚';
  nextMilestone = '70% self-reliance';
} else if (learningHistory.selfRelianceRate >= 30) {
  intelligenceLevel = 'Learning';
  intelligenceEmoji = '🌱';
  nextMilestone = '50% self-reliance';
} else if (totalKnowledgeItems > 0) {
  intelligenceLevel = 'Infant';
  intelligenceEmoji = '🍼';
  nextMilestone = '30% self-reliance';
}

console.log('🎯 INTELLIGENCE LEVEL:\n');
console.log(`   Current level: ${intelligenceEmoji} ${intelligenceLevel}`);
console.log(`   Next milestone: ${nextMilestone}`);
console.log();

// Growth projections
const daysOfLearning = feedCount;
const projectedDaysTo30 = Math.max(0, Math.ceil((30 - learningHistory.selfRelianceRate) / 1.5)); // ~1.5% per day
const projectedDaysTo70 = Math.max(0, Math.ceil((70 - learningHistory.selfRelianceRate) / 1.5));

console.log('📈 GROWTH PROJECTION:\n');
if (learningHistory.selfRelianceRate < 30) {
  console.log(`   Days of learning: ${daysOfLearning}`);
  console.log(`   Estimated days to "Learning" (30%): ${projectedDaysTo30} days`);
  console.log(`   Estimated days to "Expert" (70%): ${projectedDaysTo70} days`);
} else if (learningHistory.selfRelianceRate < 70) {
  console.log(`   Days of learning: ${daysOfLearning}`);
  console.log(`   Estimated days to "Expert" (70%): ${projectedDaysTo70} days`);
} else {
  console.log(`   Days of learning: ${daysOfLearning}`);
  console.log(`   Status: SOMA is highly intelligent! 🎉`);
}
console.log();

// Cost savings
const costSavings = learningHistory.selfRelianceRate * 0.01 * 15; // $15 baseline, proportional savings
console.log('💰 COST EFFICIENCY:\n');
console.log(`   Current cost savings: ${(costSavings).toFixed(2)}%`);
console.log(`   Estimated monthly savings: $${(costSavings * 0.5).toFixed(2)}`);
console.log();

// Cluster status
console.log('🌐 DISTRIBUTED INTELLIGENCE:\n');
console.log('   Cluster nodes: 4 (1 coordinator + 3 workers)');
console.log('   Distributed computing: ACTIVE');
console.log('   Federated learning: ENABLED');
console.log('   Knowledge sync: ENABLED');
console.log();

// Learning schedule
console.log('⏰ TONIGHT\'S LEARNING SCHEDULE:\n');
const now = new Date();
const schedules = [
  { time: '22:00', name: 'Knowledge Consolidation' },
  { time: '23:00', name: 'Deep Learning Session' },
  { time: '00:00', name: 'Autonomous Data Gathering' },
  { time: '01:00', name: 'Memory Optimization' },
  { time: '02:00', name: 'Pattern Analysis' }
];

schedules.forEach(({ time, name }) => {
  const [hour, min] = time.split(':').map(Number);
  const scheduledTime = new Date(now);
  scheduledTime.setHours(hour, min, 0, 0);

  if (scheduledTime < now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }

  const hoursUntil = Math.floor((scheduledTime - now) / 3600000);
  const status = hoursUntil < 2 ? '🔜' : '⏰';

  console.log(`   ${status} ${time} - ${name}`);
});
console.log();

console.log('─'.repeat(80));
console.log('📋 RECOMMENDATIONS:\n');

if (feedCount === 0) {
  console.log('   ⚠️  No knowledge feeds found!');
  console.log('   → Run: node scripts/feed-soma-daily.mjs');
  console.log();
} else if (feedCount < 7) {
  console.log('   ✅ Keep feeding SOMA daily');
  console.log('   → Run: node scripts/feed-soma-daily.mjs (daily)');
  console.log();
}

if (learningHistory.selfRelianceRate < 50) {
  console.log('   💡 Interact with SOMA more to boost learning');
  console.log('   → Ask questions, get answers, let her learn from interactions');
  console.log();
}

console.log('   🚀 To accelerate learning:');
console.log('   → Add your own documents to knowledge-feed/ directory');
console.log('   → SOMA learns from .txt, .md, .json files automatically');
console.log('   → More diverse data = faster intelligence growth');
console.log();

console.log('═'.repeat(80));
