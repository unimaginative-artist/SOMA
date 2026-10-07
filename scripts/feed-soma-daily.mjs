/**
 * feed-soma-daily.mjs
 *
 * Daily knowledge feeding system for SOMA
 * Run this once per day to give SOMA new knowledge to learn
 *
 * Usage: node scripts/feed-soma-daily.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('═'.repeat(80));
console.log('  📚 SOMA DAILY KNOWLEDGE FEED');
console.log('  Building today\'s learning dataset...');
console.log('═'.repeat(80));
console.log();

// Knowledge directory
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge-feed');
const DAILY_FEED_FILE = path.join(KNOWLEDGE_DIR, `feed-${new Date().toISOString().split('T')[0]}.json`);

// Create knowledge directory if it doesn't exist
if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  console.log('✅ Created knowledge-feed directory\n');
}

// Sample knowledge categories
const knowledgeBase = {
  programming: [
    {
      topic: "JavaScript Async/Await",
      content: "async/await is syntactic sugar over Promises, making asynchronous code look synchronous. Use async functions to enable await keyword for cleaner error handling.",
      tags: ["javascript", "async", "programming"],
      priority: "high"
    },
    {
      topic: "Python Type Hints",
      content: "Type hints in Python (PEP 484) provide optional static typing. Use typing module for complex types. Benefits: better IDE support, catch errors early, improved documentation.",
      tags: ["python", "typing", "programming"],
      priority: "medium"
    },
    {
      topic: "React Hooks",
      content: "React Hooks let you use state and lifecycle features in functional components. useState for state, useEffect for side effects, useMemo for performance optimization.",
      tags: ["react", "javascript", "frontend"],
      priority: "high"
    },
    {
      topic: "Node.js Event Loop",
      content: "Node.js uses single-threaded event loop with 6 phases: timers, pending callbacks, idle/prepare, poll, check, close callbacks. Non-blocking I/O via libuv.",
      tags: ["nodejs", "javascript", "architecture"],
      priority: "high"
    }
  ],

  systemDesign: [
    {
      topic: "CAP Theorem",
      content: "In distributed systems, you can only guarantee 2 of 3: Consistency, Availability, Partition tolerance. CP systems: databases. AP systems: caches, social feeds.",
      tags: ["distributed-systems", "architecture", "databases"],
      priority: "high"
    },
    {
      topic: "Load Balancing Strategies",
      content: "Common strategies: Round Robin (even distribution), Least Connections (lowest load), IP Hash (session persistence), Weighted (capacity-based routing).",
      tags: ["distributed-systems", "networking", "scalability"],
      priority: "medium"
    },
    {
      topic: "Microservices Patterns",
      content: "Key patterns: API Gateway (single entry), Circuit Breaker (fault tolerance), Saga (distributed transactions), CQRS (separate read/write), Event Sourcing (audit trail).",
      tags: ["microservices", "architecture", "patterns"],
      priority: "high"
    }
  ],

  databases: [
    {
      topic: "SQL Indexes",
      content: "B-tree indexes speed up queries but slow writes. Use composite indexes for multi-column queries. Covering indexes avoid table lookups. Analyze query plans with EXPLAIN.",
      tags: ["sql", "databases", "performance"],
      priority: "medium"
    },
    {
      topic: "NoSQL Database Types",
      content: "Document stores (MongoDB): flexible schema. Key-value (Redis): caching. Column-family (Cassandra): time-series. Graph (Neo4j): relationships.",
      tags: ["nosql", "databases", "data-modeling"],
      priority: "medium"
    },
    {
      topic: "Database Sharding",
      content: "Horizontal partitioning splits data across servers. Hash sharding (even distribution), Range sharding (ordered data), Directory sharding (lookup table). Trade-off: complexity vs scalability.",
      tags: ["databases", "scalability", "distributed-systems"],
      priority: "high"
    }
  ],

  aiAndML: [
    {
      topic: "Transformer Architecture",
      content: "Self-attention mechanism processes entire sequence simultaneously. Multi-head attention captures different representation subspaces. Position encoding preserves sequence order.",
      tags: ["ai", "ml", "nlp"],
      priority: "high"
    },
    {
      topic: "Gradient Descent Variants",
      content: "SGD (stochastic): noisy but fast. Mini-batch: balance speed/accuracy. Adam: adaptive learning rates. Learning rate scheduling for convergence.",
      tags: ["ml", "optimization", "training"],
      priority: "medium"
    },
    {
      topic: "Overfitting Prevention",
      content: "Techniques: Regularization (L1/L2), Dropout (random neuron disable), Early stopping (validation monitoring), Data augmentation (synthetic samples), Cross-validation.",
      tags: ["ml", "training", "model-optimization"],
      priority: "high"
    }
  ],

  devOps: [
    {
      topic: "Docker Best Practices",
      content: "Use multi-stage builds, minimize layers, .dockerignore for smaller images. Don't run as root. Use health checks. Pin base image versions for reproducibility.",
      tags: ["docker", "containers", "devops"],
      priority: "medium"
    },
    {
      topic: "CI/CD Pipeline Stages",
      content: "Standard stages: Build (compile), Test (unit/integration), Security scan, Artifact storage, Deploy (staging → production), Monitor. Rollback strategy essential.",
      tags: ["cicd", "devops", "automation"],
      priority: "high"
    },
    {
      topic: "Kubernetes Deployment Strategies",
      content: "Rolling update (gradual), Blue-Green (parallel environments), Canary (gradual traffic shift), A/B testing (feature flags). Each has different risk/complexity trade-offs.",
      tags: ["kubernetes", "devops", "deployment"],
      priority: "high"
    }
  ]
};

// Build today's feed
const todaysFeed = {
  date: new Date().toISOString(),
  version: "1.0",
  source: "daily-knowledge-feed",
  totalItems: 0,
  categories: {},
  metadata: {
    feedType: "curated-knowledge",
    priority: "learning",
    processingHints: {
      categorize: true,
      summarize: true,
      index: true,
      relate: true
    }
  }
};

// Select items from each category (rotate daily)
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);

for (const [category, items] of Object.entries(knowledgeBase)) {
  // Pick 2 items per category, rotating based on day
  const selectedItems = [
    items[dayOfYear % items.length],
    items[(dayOfYear + 1) % items.length]
  ];

  todaysFeed.categories[category] = selectedItems;
  todaysFeed.totalItems += selectedItems.length;
}

// Save feed
fs.writeFileSync(DAILY_FEED_FILE, JSON.stringify(todaysFeed, null, 2));

console.log('📊 Today\'s Knowledge Feed:\n');
console.log(`   Total items: ${todaysFeed.totalItems}`);
console.log(`   Categories: ${Object.keys(todaysFeed.categories).length}\n`);

for (const [category, items] of Object.entries(todaysFeed.categories)) {
  console.log(`   ${category}:`);
  items.forEach((item, i) => {
    console.log(`      ${i + 1}. ${item.topic}`);
  });
  console.log();
}

console.log(`✅ Feed saved to: ${DAILY_FEED_FILE}\n`);

// Create index of all feeds
const feedIndex = {
  lastUpdated: new Date().toISOString(),
  totalFeeds: fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.startsWith('feed-')).length,
  latestFeed: DAILY_FEED_FILE
};

fs.writeFileSync(
  path.join(KNOWLEDGE_DIR, 'feed-index.json'),
  JSON.stringify(feedIndex, null, 2)
);

console.log('─'.repeat(80));
console.log('📅 TONIGHT\'S LEARNING SCHEDULE:\n');
console.log('   22:00 (10 PM)  - Knowledge Consolidation');
console.log('   23:00 (11 PM)  - Deep Learning Session');
console.log('   00:00 (Midnight) - Autonomous Data Gathering ⭐');
console.log('   01:00 (1 AM)   - Memory Optimization');
console.log('   02:00 (2 AM)   - Pattern Analysis');
console.log();
console.log(`   SOMA will process ${todaysFeed.totalItems} knowledge items tonight`);
console.log('─'.repeat(80));
console.log();

console.log('🚀 NEXT STEPS:\n');
console.log('   1. Feed is ready for tonight\'s learning');
console.log('   2. SOMA will automatically process at scheduled times');
console.log('   3. Run this script again tomorrow for fresh knowledge');
console.log('   4. Check progress: node scripts/check-soma-intelligence.mjs');
console.log();

console.log('💡 TIP: Add your own knowledge files to knowledge-feed/ directory');
console.log('   SOMA will discover and learn from them automatically!\n');

console.log('═'.repeat(80));
