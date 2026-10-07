#!/usr/bin/env node

/**
 * test-cognitive-simple.cjs
 * 
 * Simple test of cognitive flow:
 * 1. Query Ollama first (local)
 * 2. If low confidence, search web with Dendrite
 * 3. Synthesize with cloud provider
 */

const { Dendrite } = require('../cognitive/BaseDendrite.cjs');
const fetch = require('node-fetch');

// Simple Ollama helper
async function queryOllama(prompt) {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
        options: { temperature: 0.3 }
      })
    });

    const data = await response.json();
    
    // Estimate confidence based on response characteristics
    const responseText = data.response || '';
    const hasUncertainty = /\b(i don't|not sure|unclear|uncertain|unknown|probably|maybe|might)\b/i.test(responseText);
    // Force low confidence for testing web search flow
    const confidence = 0.5; // hasUncertainty ? 0.4 : 0.85;

    return {
      response: responseText,
      confidence,
      provider: 'ollama'
    };
  } catch (error) {
    console.error('Ollama error:', error.message);
    return {
      response: '',
      confidence: 0,
      provider: 'ollama',
      error: error.message
    };
  }
}

// Simple DeepSeek helper
async function queryDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      response: '',
      confidence: 0,
      provider: 'deepseek',
      error: 'No API key'
    };
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    const responseText = data.choices?.[0]?.message?.content || '';

    return {
      response: responseText,
      confidence: 0.9,
      provider: 'deepseek'
    };
  } catch (error) {
    console.error('DeepSeek error:', error.message);
    return {
      response: '',
      confidence: 0,
      provider: 'deepseek',
      error: error.message
    };
  }
}

// Simple Gemini helper
async function queryGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      response: '',
      confidence: 0,
      provider: 'gemini',
      error: 'No API key'
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 1000 }
        })
      }
    );

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      response: responseText,
      confidence: 0.9,
      provider: 'gemini'
    };
  } catch (error) {
    console.error('Gemini error:', error.message);
    return {
      response: '',
      confidence: 0,
      provider: 'gemini',
      error: error.message
    };
  }
}

async function testFullCognitiveFlow() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       🧠 SOMA Cognitive Flow Test - Full Chain              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const query = "What are the latest developments in quantum computing research as of November 2025?";
  
  console.log(`📝 Query: "${query}"\n`);
  console.log('─'.repeat(64));
  
  // Step 1: Query Ollama first
  console.log('\n🔹 Step 1: Querying Ollama (local, fast)...');
  const ollamaStart = Date.now();
  const ollamaResult = await queryOllama(query);
  const ollamaDuration = Date.now() - ollamaStart;
  
  console.log(`   Provider: ${ollamaResult.provider}`);
  console.log(`   Duration: ${ollamaDuration}ms`);
  console.log(`   Confidence: ${(ollamaResult.confidence * 100).toFixed(1)}%`);
  console.log(`   Response preview: ${ollamaResult.response.substring(0, 120)}...`);
  
  // Step 2: Check if we need web search
  if (ollamaResult.confidence < 0.7) {
    console.log('\n⚠️  Low confidence - triggering web search...');
    
    // Initialize Dendrite
    const dendrite = new Dendrite({
      maxResults: 3,
      enableNews: true
    });
    
    console.log('\n🔹 Step 2: Searching web with Dendrite (Brave Search API)...');
    const searchStart = Date.now();
    const searchResults = await dendrite.search(query, {
      maxResults: 3
    });
    const searchDuration = Date.now() - searchStart;
    
    console.log(`   Duration: ${searchDuration}ms`);
    console.log(`   Results found: ${searchResults.results?.length || 0}`);
    
    if (searchResults.results && searchResults.results.length > 0) {
      console.log(`   Top results:`);
      searchResults.results.slice(0, 3).forEach((r, i) => {
        console.log(`     ${i + 1}. ${r.title}`);
        console.log(`        ${r.url}`);
      });
      
      // Step 3: Synthesize with cloud provider
      console.log('\n🔹 Step 3: Synthesizing with cloud provider...');
      
      const synthesisContext = searchResults.results
        .map(r => `[${r.title}] ${r.snippet}`)
        .join('\n\n');
      
      const synthesisPrompt = `${query}\n\nWeb search results:\n${synthesisContext}\n\nProvide a comprehensive, accurate answer based on these search results.`;
      
      // Try DeepSeek first, then Gemini
      let synthesisResult = await queryDeepSeek(synthesisPrompt);
      if (!synthesisResult.response) {
        console.log('   DeepSeek unavailable, trying Gemini...');
        synthesisResult = await queryGemini(synthesisPrompt);
      }
      
      console.log(`   Synthesis provider: ${synthesisResult.provider}`);
      console.log(`   Final confidence: ${(synthesisResult.confidence * 100).toFixed(1)}%`);
      console.log(`   Final response preview: ${synthesisResult.response.substring(0, 150)}...\n`);
      
      console.log('─'.repeat(64));
      console.log('\n✅ Full cognitive flow completed!');
      console.log(`   Flow: Ollama (${ollamaDuration}ms, low confidence) → Dendrite (${searchDuration}ms, ${searchResults.results.length} results) → ${synthesisResult.provider} (synthesis)`);
      console.log(`   Total time: ${Date.now() - ollamaStart}ms`);
      
    } else {
      console.log('   ❌ No search results found');
    }
    
  } else {
    console.log('\n✅ High confidence answer from Ollama - web search not needed');
    console.log(`   Flow: Ollama only (${ollamaDuration}ms)`);
  }
  
  console.log('\n');
}

// Run test
testFullCognitiveFlow()
  .then(() => {
    console.log('✅ Test complete\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    console.error(err.stack);
    process.exit(1);
  });
