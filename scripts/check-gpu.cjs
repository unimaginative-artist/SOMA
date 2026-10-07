#!/usr/bin/env node

const { exec } = require('child_process');
const fetch = require('node-fetch');

async function monitorGPU() {
  console.log('🔍 Monitoring GPU during Ollama inference...\n');
  
  // Start monitoring GPU in background
  const gpuCheck = setInterval(() => {
    exec('nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader', (err, stdout) => {
      if (!err) {
        const [gpuUtil, memUsed] = stdout.trim().split(',');
        console.log(`GPU: ${gpuUtil.trim()} | VRAM: ${memUsed.trim()}`);
      }
    });
  }, 500);

  // Run inference
  console.log('Running inference with Gemma3:4b...\n');
  
  const start = Date.now();
  
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      prompt: 'Explain AI in 10 words.',
      stream: false,
      options: {
        num_ctx: 1024,
        temperature: 0.3
      }
    })
  });

  const data = await response.json();
  const duration = Date.now() - start;
  
  clearInterval(gpuCheck);
  
  console.log(`\n✅ Inference complete: ${duration}ms`);
  console.log(`Response: ${data.response}\n`);
  
  // Check if GPU layers are loaded
  exec('ollama ps', (err, stdout) => {
    if (!err) {
      console.log('Ollama status:\n' + stdout);
    }
  });
}

monitorGPU().catch(console.error);
