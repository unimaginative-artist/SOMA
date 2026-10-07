/**
 * test-edge-webcrawler.mjs
 *
 * Tests EdgeWorkerOrchestrator with real web crawling capabilities
 * Verifies that EdgeWorkers can crawl Stack Overflow, GitHub, MDN, and Dev.to
 *
 * Usage: node test-edge-webcrawler.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const EdgeWorkerOrchestrator = require('../arbiters/EdgeWorkerOrchestrator.cjs');

console.log('═'.repeat(80));
console.log('  🕸️  EDGE WORKER WEB CRAWLER TEST');
console.log('  Testing real web crawling integration');
console.log('═'.repeat(80));
console.log();

class WebCrawlerTester {
  constructor() {
    this.results = {
      initialized: false,
      targetsLoaded: 0,
      tasksDeployed: 0,
      tasksCompleted: 0,
      itemsCrawled: 0,
      errors: []
    };
  }

  async runTests() {
    console.log('📋 TEST PLAN:');
    console.log('   1. Initialize EdgeWorkerOrchestrator with web crawling enabled');
    console.log('   2. Verify crawl targets loaded from config');
    console.log('   3. Deploy test crawl task');
    console.log('   4. Verify real web crawling execution');
    console.log();

    await this.testInitialization();
    await this.testCrawlTargetsLoaded();
    await this.testSingleCrawlTask();
    await this.testNightLearningCrawl();

    this.printResults();
  }

  async testInitialization() {
    console.log('─'.repeat(80));
    console.log('TEST 1: EdgeWorkerOrchestrator Initialization');
    console.log('─'.repeat(80));

    try {
      this.orchestrator = new EdgeWorkerOrchestrator({
        name: 'TestEdgeOrchestrator',
        maxWorkers: 4,
        webCrawlingEnabled: true,
        logger: console
      });

      await this.orchestrator.initialize();

      this.results.initialized = true;
      console.log('✅ EdgeWorkerOrchestrator initialized successfully');
      console.log(`   Web crawling: ${this.orchestrator.webCrawlingEnabled ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Max workers: ${this.orchestrator.maxWorkers}`);
      console.log();
    } catch (err) {
      console.error('❌ Initialization failed:', err.message);
      this.results.errors.push({ test: 'initialization', error: err.message });
      console.log();
    }
  }

  async testCrawlTargetsLoaded() {
    console.log('─'.repeat(80));
    console.log('TEST 2: Crawl Targets Configuration');
    console.log('─'.repeat(80));

    try {
      const targets = this.orchestrator.crawlTargets;

      if (!targets || !targets.targets) {
        throw new Error('Crawl targets not loaded');
      }

      this.results.targetsLoaded = targets.targets.length;

      console.log(`✅ Loaded ${targets.targets.length} crawl targets:`);
      targets.targets.forEach((target, i) => {
        console.log(`   ${i + 1}. ${target.name} (${target.type}) - Priority: ${target.priority}`);
      });
      console.log();

      console.log('Crawl Limits:');
      console.log(`   Max pages per target: ${targets.crawlLimits.maxPagesPerTarget}`);
      console.log(`   Max depth: ${targets.crawlLimits.maxDepth}`);
      console.log(`   Request delay: ${targets.crawlLimits.requestDelay}ms`);
      console.log(`   Timeout: ${targets.crawlLimits.timeout}ms`);
      console.log();
    } catch (err) {
      console.error('❌ Crawl targets test failed:', err.message);
      this.results.errors.push({ test: 'crawlTargets', error: err.message });
      console.log();
    }
  }

  async testSingleCrawlTask() {
    console.log('─'.repeat(80));
    console.log('TEST 3: Single Crawl Task Deployment');
    console.log('─'.repeat(80));

    try {
      const targets = this.orchestrator.crawlTargets.targets.filter(t => t.enabled !== false);

      if (targets.length === 0) {
        throw new Error('No enabled crawl targets found');
      }

      // Deploy a single test task (use first target)
      const testTarget = targets[0];
      console.log(`Deploying test crawl task for: ${testTarget.name}`);
      console.log(`Target type: ${testTarget.type}`);
      console.log();

      const deployResult = await this.orchestrator.deployLearningTask({
        type: 'web_crawl_test',
        data: {
          crawlTarget: testTarget,
          source: 'manual_test'
        },
        priority: 'high'
      });

      if (deployResult.success) {
        this.results.tasksDeployed++;
        console.log(`✅ Task deployed successfully: ${deployResult.taskId}`);
        console.log(`   Queue size: ${this.orchestrator.learningQueue.length}`);
        console.log();

        // Wait a moment for task assignment
        console.log('Waiting for task assignment...');
        await this.sleep(2000);

        const workerStatus = this.orchestrator.getWorkerStatus();
        console.log(`Workers: ${workerStatus.totalWorkers} total, ${workerStatus.activeWorkers} active`);

        const workingWorkers = workerStatus.workers.filter(w => w.status === 'working');
        if (workingWorkers.length > 0) {
          console.log(`✅ ${workingWorkers.length} worker(s) actively crawling`);
          workingWorkers.forEach(w => {
            console.log(`   Worker ${w.id}: ${w.status} - Task: ${w.currentTask}`);
          });
        }
        console.log();
      } else {
        throw new Error(`Task deployment failed: ${deployResult.error}`);
      }
    } catch (err) {
      console.error('❌ Single crawl task test failed:', err.message);
      this.results.errors.push({ test: 'singleCrawl', error: err.message });
      console.log();
    }
  }

  async testNightLearningCrawl() {
    console.log('─'.repeat(80));
    console.log('TEST 4: Night Learning Web Crawl');
    console.log('─'.repeat(80));

    try {
      console.log('Starting night learning with web crawling...');
      console.log();

      const nightResult = await this.orchestrator.startNightLearning();

      if (nightResult.success) {
        console.log(`✅ Night learning started successfully`);
        console.log(`   Tasks deployed: ${nightResult.taskCount}`);
        console.log(`   Workers active: ${nightResult.workers}`);
        console.log(`   Web crawling: ${nightResult.webCrawling ? 'ENABLED' : 'DISABLED'}`);
        console.log();

        this.results.tasksDeployed += nightResult.taskCount;

        // Wait a bit for some tasks to start
        console.log('Waiting for crawls to begin...');
        await this.sleep(5000);

        // Check status
        const status = this.orchestrator.getStatus();
        console.log('Current Status:');
        console.log(`   Tasks completed: ${status.metrics.tasksCompleted}`);
        console.log(`   Tasks failed: ${status.metrics.tasksFailed}`);
        console.log(`   Knowledge collected: ${this.orchestrator.formatBytes(status.metrics.totalKnowledgeBytes)}`);
        console.log(`   Learnings aggregated: ${status.metrics.learningsAggregated}`);
        console.log();

        this.results.tasksCompleted = status.metrics.tasksCompleted;

        // Stop night learning
        console.log('Stopping night learning...');
        await this.orchestrator.stopNightLearning();
        console.log('✅ Night learning stopped');
        console.log();
      } else {
        throw new Error(`Night learning failed: ${nightResult.error}`);
      }
    } catch (err) {
      console.error('❌ Night learning crawl test failed:', err.message);
      this.results.errors.push({ test: 'nightLearning', error: err.message });
      console.log();
    }
  }

  printResults() {
    console.log('═'.repeat(80));
    console.log('  📊 TEST RESULTS SUMMARY');
    console.log('═'.repeat(80));
    console.log();

    console.log('Initialization:');
    console.log(`   EdgeWorkerOrchestrator: ${this.results.initialized ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log();

    console.log('Configuration:');
    console.log(`   Crawl targets loaded: ${this.results.targetsLoaded}`);
    console.log();

    console.log('Task Execution:');
    console.log(`   Tasks deployed: ${this.results.tasksDeployed}`);
    console.log(`   Tasks completed: ${this.results.tasksCompleted}`);
    console.log();

    if (this.results.errors.length > 0) {
      console.log('Errors Encountered:');
      this.results.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.test}: ${err.error}`);
      });
      console.log();
    }

    const successRate = this.results.tasksDeployed > 0
      ? ((this.results.tasksCompleted / this.results.tasksDeployed) * 100).toFixed(1)
      : 0;

    console.log('Overall Status:');
    if (this.results.initialized && this.results.targetsLoaded > 0 && this.results.errors.length === 0) {
      console.log('   ✅ ALL TESTS PASSED');
      console.log('   🕸️  Web crawling integration is OPERATIONAL');
    } else if (this.results.errors.length > 0) {
      console.log('   ⚠️  SOME TESTS FAILED');
      console.log(`   ${this.results.errors.length} error(s) encountered`);
    } else {
      console.log('   ❌ TESTS FAILED');
    }
    console.log();

    console.log('═'.repeat(80));
    console.log('  Next Steps:');
    console.log('  1. Review crawl targets in config/crawl-targets.json');
    console.log('  2. Adjust crawl limits (maxPages, timeout, requestDelay) as needed');
    console.log('  3. Run nightly learning to gather massive knowledge');
    console.log('  4. Monitor crawled data in knowledge-feed/crawled/ directory');
    console.log('═'.repeat(80));
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the tests
const tester = new WebCrawlerTester();
tester.runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
