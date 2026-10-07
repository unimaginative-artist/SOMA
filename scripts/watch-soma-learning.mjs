/**
 * watch-soma-learning.mjs
 *
 * Real-time monitor for SOMA's learning activity
 * Shows when she's learning, what she's doing, and her progress
 *
 * Usage: node scripts/watch-soma-learning.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SomaLearningMonitor {
  constructor() {
    this.knowledgeDir = path.join(__dirname, '../knowledge-feed');
    this.logsDir = path.join(__dirname, '../logs');
    this.somaDir = path.join(__dirname, '../.soma');

    this.lastKnowledgeCount = 0;
    this.lastLogSize = 0;
    this.learningActive = false;

    // Create logs dir if doesn't exist
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  async start() {
    console.log('═'.repeat(80));
    console.log('  👁️  SOMA LEARNING MONITOR - REAL-TIME');
    console.log('  Watching for learning activity...');
    console.log('═'.repeat(80));
    console.log();

    // Initial status
    await this.checkStatus();

    // Watch for changes every 5 seconds
    setInterval(() => this.checkStatus(), 5000);
  }

  async checkStatus() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    // Check if in learning window (10 PM - 4:30 AM)
    const inLearningWindow = (hour >= 22) || (hour <= 4 && (hour < 4 || minute <= 30));

    // Check knowledge feeds
    const feeds = this.getKnowledgeFeeds();
    const knowledgeChanged = feeds.length !== this.lastKnowledgeCount;
    this.lastKnowledgeCount = feeds.length;

    // Check for recent log activity
    const recentActivity = this.checkRecentActivity();

    // Check SOMA directory for learning artifacts
    const learningArtifacts = this.checkLearningArtifacts();

    // Display status
    process.stdout.write('\r\x1b[K'); // Clear line

    let status = `[${timeStr}] `;

    if (inLearningWindow && recentActivity) {
      status += '🟢 LEARNING ACTIVE';
      this.learningActive = true;
    } else if (inLearningWindow) {
      status += '🟡 LEARNING WINDOW (waiting for activity)';
    } else {
      status += '⚪ IDLE';
      this.learningActive = false;
    }

    status += ` | Feeds: ${feeds.length}`;

    if (recentActivity) {
      status += ` | Activity: ${recentActivity}`;
    }

    if (learningArtifacts > 0) {
      status += ` | Artifacts: ${learningArtifacts}`;
    }

    process.stdout.write(status);

    // Print newline on status changes
    if (knowledgeChanged || (this.learningActive && recentActivity)) {
      console.log();

      if (knowledgeChanged) {
        console.log(`  📚 New knowledge feed detected! Total: ${feeds.length}`);
      }

      if (recentActivity) {
        console.log(`  🧠 ${recentActivity}`);
      }
    }
  }

  getKnowledgeFeeds() {
    if (!fs.existsSync(this.knowledgeDir)) {
      return [];
    }

    return fs.readdirSync(this.knowledgeDir)
      .filter(f => f.startsWith('feed-') && f.endsWith('.json'));
  }

  checkRecentActivity() {
    const activityFiles = [
      path.join(this.logsDir, 'nighttime-learning.log'),
      path.join(this.logsDir, 'daily-feed.log'),
      path.join(this.logsDir, 'soma-learning.log')
    ];

    for (const logFile of activityFiles) {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        const ageMinutes = (Date.now() - stats.mtimeMs) / 60000;

        if (ageMinutes < 5) {
          // File modified in last 5 minutes
          const lines = fs.readFileSync(logFile, 'utf8').split('\n');
          const lastLine = lines.filter(l => l.trim()).pop();

          if (lastLine) {
            return `Recent: ${path.basename(logFile)} - ${lastLine.substring(0, 50)}...`;
          }
        }
      }
    }

    return null;
  }

  checkLearningArtifacts() {
    if (!fs.existsSync(this.somaDir)) {
      return 0;
    }

    let count = 0;

    try {
      const files = fs.readdirSync(this.somaDir);

      // Count recent learning artifacts
      for (const file of files) {
        const filePath = path.join(this.somaDir, file);
        const stats = fs.statSync(filePath);
        const ageHours = (Date.now() - stats.mtimeMs) / 3600000;

        if (ageHours < 24) {
          count++;
        }
      }
    } catch (err) {
      // Directory might not be accessible
    }

    return count;
  }
}

// Start monitoring
const monitor = new SomaLearningMonitor();
monitor.start();

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n');
  console.log('═'.repeat(80));
  console.log('  Monitor stopped');
  console.log('═'.repeat(80));
  process.exit(0);
});
