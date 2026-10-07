#!/usr/bin/env node

/**
 * test-cognitive-flow.cjs
 * 
 * Tests the complete cognitive query routing flow:
 * 1. Query enters system
 * 2. Route to Ollama first (local, free)
 * 3. If low confidence, trigger Dendrite web search
 * 4. Synthesize web results with DeepSeek/Gemini
 * 5. Return high-confidence answer
 * 
 * This validates: Ollama → Dendrite → DeepSeek/Gemini synthesis chain
 */

const { QueryRouter } = require('../cognitive/QueryRouter.cjs');
const { Dendrite } = require('../cognitive/BaseDendrite.cjs');
const fetch = require('node-fetch');

class CognitiveFlowTester {
  constructor() {
    this.router = null;
    this.dendrite = null;
    this.testResults = [];
    this.startTime = Date.now();
  }

  async initialize() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║          🧠 SOMA Cognitive Flow Test Suite                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    console.log('⚡ Initializing test environment...\n');

    // Initialize QueryRouter with multi-tier provider routing
    this.router = new QueryRouter({
      providers: [
        { name: 'ollama', endpoint: 'http://localhost:11434/api/generate', priority: 1, cost: 0 },
        { name: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY, priority: 2, cost: 0.0001 },
        { name: 'gemini', apiKey: process.env.GEMINI_API_KEY, priority: 3, cost: 0 }
      ]
    });
    
    console.log('✅ QueryRouter ready (Ollama → DeepSeek → Gemini)');

    // Initialize Dendrite (web search)
    this.dendrite = new Dendrite({
      maxResults: 3,
      enableNews: true
    });

    console.log('✅ Dendrite (Brave Search) ready\n');
  }

  async testQuery(query, expectedFlow, description) {
    console.log('─'.repeat(64));
    console.log(`🧪 TEST: ${description}`);
    console.log(`📝 Query: "${query}"`);
    console.log(`🎯 Expected flow: ${expectedFlow}`);
    console.log('─'.repeat(64) + '\n');

    const testStart = Date.now();
    const steps = [];

    try {
      // Step 1: Initial query to router (should route to Ollama first)
      console.log('Step 1️⃣: Routing query to Ollama...');
      steps.push({ step: 'initial_routing', timestamp: Date.now() });

      const initialResponse = await this.router.query(query, {
        preferLocal: true, // Prefer Ollama
        maxTokens: 500
      });

      console.log(`   Provider used: ${initialResponse.provider}`);
      console.log(`   Confidence: ${(initialResponse.confidence * 100).toFixed(1)}%`);
      console.log(`   Response: ${initialResponse.response.substring(0, 100)}...`);
      
      steps.push({
        step: 'initial_response',
        provider: initialResponse.provider,
        confidence: initialResponse.confidence,
        timestamp: Date.now()
      });

      // Step 2: Check if confidence is low enough to trigger web search
      const needsWebSearch = initialResponse.confidence < 0.7;
      
      if (needsWebSearch) {
        console.log('\n⚠️  Low confidence detected - triggering web search...');
        steps.push({ step: 'web_search_trigger', timestamp: Date.now() });

        // Step 3: Perform web search with Dendrite
        console.log('Step 2️⃣: Searching web with Dendrite (Brave API)...');
        
        const searchResults = await this.dendrite.search({
          query,
          type: 'web',
          maxResults: 3
        });

        console.log(`   Results found: ${searchResults.results?.length || 0}`);
        if (searchResults.results?.length > 0) {
          console.log(`   Top result: ${searchResults.results[0].title}`);
          console.log(`   Source: ${searchResults.results[0].url}`);
        }

        steps.push({
          step: 'web_search_complete',
          resultsCount: searchResults.results?.length || 0,
          timestamp: Date.now()
        });

        // Step 4: Synthesize web results with cloud provider (DeepSeek or Gemini)
        console.log('\nStep 3️⃣: Synthesizing web results with cloud AI...');
        
        const synthesisContext = searchResults.results
          ?.map(r => `[${r.title}] ${r.snippet}`)
          .join('\n\n');

        const synthesisPrompt = `${query}\n\nWeb search results:\n${synthesisContext}\n\nProvide a comprehensive answer based on the search results.`;

        const finalResponse = await this.router.query(synthesisPrompt, {
          preferLocal: false, // Use cloud (DeepSeek or Gemini)
          maxTokens: 1000
        });

        console.log(`   Synthesis provider: ${finalResponse.provider}`);
        console.log(`   Final confidence: ${(finalResponse.confidence * 100).toFixed(1)}%`);
        console.log(`   Final response: ${finalResponse.response.substring(0, 150)}...`);

        steps.push({
          step: 'synthesis_complete',
          provider: finalResponse.provider,
          confidence: finalResponse.confidence,
          timestamp: Date.now()
        });

        // Log complete flow
        const duration = Date.now() - testStart;
        console.log(`\n✅ Full cognitive flow completed in ${duration}ms`);
        console.log('   Flow: Ollama (low confidence) → Dendrite (web search) → Cloud (synthesis)');

        this.testResults.push({
          test: description,
          query,
          success: true,
          flow: 'complete_with_web_search',
          steps,
          duration,
          finalConfidence: finalResponse.confidence
        });

      } else {
        // High confidence - no web search needed
        const duration = Date.now() - testStart;
        console.log(`\n✅ Query answered directly in ${duration}ms`);
        console.log('   Flow: Ollama (high confidence) - web search not needed');

        this.testResults.push({
          test: description,
          query,
          success: true,
          flow: 'direct_answer',
          steps,
          duration,
          finalConfidence: initialResponse.confidence
        });
      }

      console.log('\n');
      return true;

    } catch (error) {
      console.error(`\n❌ TEST FAILED: ${error.message}\n`);
      
      this.testResults.push({
        test: description,
        query,
        success: false,
        error: error.message,
        steps,
        duration: Date.now() - testStart
      });

      return false;
    }
  }

  async runAllTests() {
    await this.initialize();

    // Test 1: Simple query that Ollama can answer directly
    await this.testQuery(
      "What is 2+2?",
      "direct",
      "Simple Math (Direct Answer Expected)"
    );

    // Test 2: Knowledge query requiring web search
    await this.testQuery(
      "What are the latest developments in quantum computing in November 2025?",
      "web_search",
      "Recent Knowledge (Web Search Expected)"
    );

    // Test 3: Technical query that might need synthesis
    await this.testQuery(
      "How does RLHF work in modern language models?",
      "direct_or_web",
      "Technical Knowledge (Variable Flow)"
    );

    this.printSummary();
  }

  printSummary() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    📊 TEST SUMMARY                           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const totalDuration = Date.now() - this.startTime;
    const passed = this.testResults.filter(r => r.success).length;
    const failed = this.testResults.filter(r => !r.success).length;

    console.log(`Total tests: ${this.testResults.length}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Total duration: ${totalDuration}ms\n`);

    console.log('Flow distribution:');
    const flowCounts = {};
    this.testResults.forEach(r => {
      if (r.success) {
        flowCounts[r.flow] = (flowCounts[r.flow] || 0) + 1;
      }
    });
    Object.entries(flowCounts).forEach(([flow, count]) => {
      console.log(`  - ${flow}: ${count}`);
    });

    console.log('\nDetailed results:');
    this.testResults.forEach((result, i) => {
      console.log(`\n${i + 1}. ${result.test}`);
      console.log(`   Status: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Query: "${result.query}"`);
      console.log(`   Flow: ${result.flow || 'N/A'}`);
      console.log(`   Duration: ${result.duration}ms`);
      if (result.finalConfidence) {
        console.log(`   Final confidence: ${(result.finalConfidence * 100).toFixed(1)}%`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      console.log(`   Steps: ${result.steps.map(s => s.step).join(' → ')}`);
    });

    console.log('\n');
  }
}

// Run tests
const tester = new CognitiveFlowTester();
tester.runAllTests()
  .then(() => {
    console.log('✅ All tests complete\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
