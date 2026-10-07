#!/usr/bin/env node
// Direct test of Brain A (Prometheus via Ollama)
const http = require('http');
const { URL } = require('url');

async function testBrainA() {
  const endpoint = 'http://192.168.1.250:11434';
  const model = 'gemma3:4b';
  const url = new URL('/api/generate', endpoint);
  
  const prompt = `You are a creative AI. Explain quantum entanglement in one creative sentence:`;
  
  const payload = JSON.stringify({
    model,
    prompt,
    temperature: 1.2,
    num_predict: 100,
    stream: false
  });

  console.log('🧠 Testing Brain A (Prometheus)...');
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Model: ${model}`);
  console.log(`   Prompt: ${prompt.substring(0, 50)}...`);
  console.log('');

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.response) {
            console.log('✅ Response received!');
            console.log(`   Text: ${result.response}`);
            console.log(`   Done: ${result.done}`);
            resolve(result.response);
          } else {
            console.log('❌ No response field');
            console.log(`   Full result: ${JSON.stringify(result).substring(0, 200)}`);
            reject(new Error('No response from Ollama'));
          }
        } catch (e) {
          console.log('❌ Parse error:', e.message);
          console.log(`   Data: ${data.substring(0, 200)}`);
          reject(e);
        }
      });
    });
    req.on('error', (e) => {
      console.log('❌ Request error:', e.message);
      reject(e);
    });
    req.write(payload);
    req.end();
  });
}

testBrainA().catch(console.error);
