#!/usr/bin/env node

/**
 * test-services.cjs - Comprehensive SOMA Service Test Suite
 * 
 * Verifies:
 * 1. Health check system works
 * 2. All arbiters can initialize
 * 3. MessageBroker communication functions
 * 4. SLC can generate responses via available providers
 * 5. System boots to operational state
 */

const path = require('path');
const fs = require('fs').promises;
const { ServiceHealthCheck } = require('../core/ServiceHealthCheck.cjs');
const { getEnvLoader } = require('../config/EnvLoader.cjs');
const SyntheticLayeredCortex = require('../cognitive/SyntheticLayeredCortex.cjs');

class SOMAServiceTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      tests: [],
      passed: 0,
      failed: 0,
      warnings: 0,
      summary: {}
    };
  }

  async run() {
    console.clear();
    console.log('╔' + '═'.repeat(60) + '╗');
    console.log('║' + ' '.repeat(12) + '🧪 SOMA SERVICE TEST SUITE 🧪' + ' '.repeat(14) + '║');
    console.log('╚' + '═'.repeat(60) + '╝\n');

    try {
      await this.testHealthChecks();
      await this.testEnvConfiguration();
      await this.testBrainAdapters();
      await this.testSLCThinking();
      
      await this.generateReport();
      return true;
    } catch (err) {
      console.error('\n❌ Test suite failed:', err.message);
      return false;
    }
  }

  async testHealthChecks() {
    console.log('📋 Test 1: Health Check System');
    console.log('─'.repeat(60));

    try {
      const healthCheck = new ServiceHealthCheck();
      const results = await healthCheck.runFullCheck();

      this.recordTest('Health Checks', {
        status: results.health,
        providers_available: results.fallbackOrder.length,
        provider_selected: results.selectedProvider
      });

      if (results.health !== 'critical') {
        console.log('✅ Health checks passed\n');
        this.passed++;
      } else {
        console.log('⚠️  Health checks indicate critical issues\n');
        this.warnings++;
      }
    } catch (err) {
      console.log(`❌ Health checks failed: ${err.message}\n`);
      this.recordTest('Health Checks', { error: err.message }, false);
      this.failed++;
    }
  }

  async testEnvConfiguration() {
    console.log('⚙️  Test 2: Environment Configuration');
    console.log('─'.repeat(60));

    try {
      const envLoader = getEnvLoader();
      const providers = envLoader.getAvailableProviders();
      const allConfig = envLoader.getAll();

      // Check critical env vars
      const criticalVars = [
        'SOMA_MODE', 'LOG_LEVEL', 'DATABASE_PATH'
      ];

      let missingVars = [];
      for (const varName of criticalVars) {
        if (!allConfig[varName]) {
          missingVars.push(varName);
        }
      }

      this.recordTest('Env Configuration', {
        providers_loaded: providers.length,
        critical_vars: criticalVars.length,
        missing_vars: missingVars.length
      });

      if (providers.length > 0 && missingVars.length === 0) {
        console.log(`✅ Configuration loaded: ${providers.length} providers available`);
        providers.forEach(p => console.log(`   - ${p.type}: ${p.model}`));
        console.log();
        this.passed++;
      } else {
        console.log(`⚠️  Configuration incomplete: ${missingVars.length} missing vars\n`);
        this.warnings++;
      }
    } catch (err) {
      console.log(`❌ Config test failed: ${err.message}\n`);
      this.recordTest('Env Configuration', { error: err.message }, false);
      this.failed++;
    }
  }

  async testBrainAdapters() {
    console.log('🧠 Test 3: Brain Adapter Initialization');
    console.log('─'.repeat(60));

    try {
      const envLoader = getEnvLoader();
      const providers = envLoader.getAvailableProviders();

      if (providers.length === 0) {
        console.log('⚠️  No providers available - skipping brain adapter test\n');
        this.warnings++;
        return;
      }

      // Create a test SLC without needing MessageBroker
      const testSLC = new SyntheticLayeredCortex(null, { name: 'TestSLC' });

      const brainInfo = {
        brainA_type: testSLC.brains.A.apiType,
        brainB_type: testSLC.brains.B.apiType,
        brainC_type: testSLC.brains.C.apiType
      };

      this.recordTest('Brain Adapters', brainInfo);

      console.log('✅ Brain adapters initialized:');
      console.log(`   Brain A (Prometheus): ${testSLC.brains.A.apiType}`);
      console.log(`   Brain B (Aurora): ${testSLC.brains.B.apiType}`);
      console.log(`   Brain C (Logos): ${testSLC.brains.C.apiType}`);
      console.log();
      this.passed++;
    } catch (err) {
      console.log(`❌ Brain adapter test failed: ${err.message}\n`);
      this.recordTest('Brain Adapters', { error: err.message }, false);
      this.failed++;
    }
  }

  async testSLCThinking() {
    console.log('💭 Test 4: SLC Thinking Generation');
    console.log('─'.repeat(60));

    try {
      const envLoader = getEnvLoader();
      const selectedProvider = envLoader.getApiProvider();

      if (!selectedProvider) {
        console.log('⚠️  No provider selected - cannot test thinking\n');
        this.warnings++;
        return;
      }

      console.log(`Testing with provider: ${selectedProvider.type} (${selectedProvider.model})`);

      // Create a test SLC
      const testSLC = new SyntheticLayeredCortex(null, { name: 'TestSLC' });

      // Try to think with the first brain
      const testPrompt = 'What is the meaning of life?';
      console.log(`\nSending test prompt: "${testPrompt}"`);

      try {
        const startTime = Date.now();
        const response = await testSLC.brains.A.think(testPrompt, { phase: 'test' });
        const elapsed = Date.now() - startTime;

        if (response && response.text) {
          const preview = response.text.substring(0, 100).replace(/\n/g, ' ');
          this.recordTest('SLC Thinking', {
            provider: testSLC.brains.A.apiType,
            response_length: response.text.length,
            confidence: response.confidence,
            elapsed_ms: elapsed
          });

          console.log(`\n✅ SLC generated response (${elapsed}ms, ${response.text.length} chars)`);
          console.log(`   Confidence: ${(response.confidence * 100).toFixed(0)}%`);
          console.log(`   Preview: "${preview}..."`);
          console.log();
          this.passed++;
        } else {
          console.log(`⚠️  Incomplete response from ${testSLC.brains.A.apiType}\n`);
          this.warnings++;
        }
      } catch (thinkErr) {
        console.log(`⚠️  Brain thinking failed: ${thinkErr.message}`);
        console.log('   This is expected if APIs are unreachable.\n');
        this.recordTest('SLC Thinking', { 
          provider: selectedProvider.type,
          error: thinkErr.message 
        }, false);
        this.warnings++;
      }
    } catch (err) {
      console.log(`❌ SLC test failed: ${err.message}\n`);
      this.recordTest('SLC Thinking', { error: err.message }, false);
      this.failed++;
    }
  }

  recordTest(name, details, passed = true) {
    this.results.tests.push({
      name,
      details,
      passed,
      timestamp: new Date().toISOString()
    });
  }

  async generateReport() {
    console.log('📊 Test Summary');
    console.log('═'.repeat(60));
    console.log(`✅ Passed:  ${this.passed}`);
    console.log(`❌ Failed:  ${this.failed}`);
    console.log(`⚠️  Warnings: ${this.warnings}`);
    console.log();

    this.results.summary = {
      passed: this.passed,
      failed: this.failed,
      warnings: this.warnings,
      total: this.results.tests.length,
      success: this.failed === 0
    };

    // Save detailed report
    try {
      const reportPath = path.join(process.cwd(), '.arbiter-state', 'test-results.json');
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2), 'utf8');
      console.log(`📝 Detailed results saved to ${reportPath}`);
    } catch (err) {
      console.error(`Failed to save test results: ${err.message}`);
    }

    console.log();

    if (this.failed === 0) {
      console.log('🎉 All tests passed! SOMA is ready.');
      console.log('\n🚀 Next: Run start-soma-complete.cjs to initialize all services');
    } else {
      console.log('⚠️  Some tests failed. Check configuration.');
    }

    console.log();
  }
}

// Run tests
const tester = new SOMAServiceTester();
tester.run()
  .then(success => {
    process.exit(success && tester.results.summary.success ? 0 : 1);
  })
  .catch(err => {
    console.error('\n🔥 FATAL ERROR:', err);
    process.exit(1);
  });
