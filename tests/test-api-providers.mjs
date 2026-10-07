/**
 * test-api-providers.mjs - Verify All API Providers
 *
 * Tests connectivity and authentication for:
 * - OpenAI (Priority 1)
 * - Gemini (Priority 2)
 * - DeepSeek (Priority 3)
 * - Ollama (Priority 4 - Local)
 *
 * Run before starting federated learning to ensure all providers work.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

console.log('═'.repeat(70));
console.log('  API PROVIDER VERIFICATION');
console.log('  Testing all configured LLM providers for federated learning');
console.log('═'.repeat(70));

// ============================================================
// Provider Test Functions
// ============================================================

async function testOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey || apiKey === 'sk-your-key-here') {
    return {
      provider: 'OpenAI',
      priority: 1,
      status: 'not_configured',
      message: 'API key not set in .env file',
      cost: '$0.15/1M tokens'
    };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 5
      })
    });

    if (response.status === 401) {
      return {
        provider: 'OpenAI',
        priority: 1,
        status: 'invalid_key',
        message: 'Invalid API key',
        cost: '$0.15/1M tokens'
      };
    }

    if (response.status === 429) {
      return {
        provider: 'OpenAI',
        priority: 1,
        status: 'quota_exceeded',
        message: 'Rate limit or quota exceeded',
        cost: '$0.15/1M tokens'
      };
    }

    if (response.ok) {
      return {
        provider: 'OpenAI',
        priority: 1,
        status: 'working',
        message: `Successfully connected (model: ${model})`,
        cost: '$0.15/1M tokens'
      };
    }

    return {
      provider: 'OpenAI',
      priority: 1,
      status: 'error',
      message: `HTTP ${response.status}: ${response.statusText}`,
      cost: '$0.15/1M tokens'
    };

  } catch (error) {
    return {
      provider: 'OpenAI',
      priority: 1,
      status: 'error',
      message: error.message,
      cost: '$0.15/1M tokens'
    };
  }
}

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';

  if (!apiKey || apiKey === 'your-gemini-key-here') {
    return {
      provider: 'Gemini',
      priority: 2,
      status: 'not_configured',
      message: 'API key not set in .env file',
      cost: 'FREE (generous tier)'
    };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'Test' }]
        }]
      })
    });

    if (response.status === 400) {
      const data = await response.json();
      if (data.error?.message?.includes('API key')) {
        return {
          provider: 'Gemini',
          priority: 2,
          status: 'invalid_key',
          message: 'Invalid API key',
          cost: 'FREE (generous tier)'
        };
      }
    }

    if (response.status === 429) {
      return {
        provider: 'Gemini',
        priority: 2,
        status: 'quota_exceeded',
        message: 'Rate limit exceeded (60 req/min, 1500 req/day)',
        cost: 'FREE (generous tier)'
      };
    }

    if (response.ok) {
      return {
        provider: 'Gemini',
        priority: 2,
        status: 'working',
        message: `Successfully connected (model: ${model})`,
        cost: 'FREE (generous tier)'
      };
    }

    return {
      provider: 'Gemini',
      priority: 2,
      status: 'error',
      message: `HTTP ${response.status}: ${response.statusText}`,
      cost: 'FREE (generous tier)'
    };

  } catch (error) {
    return {
      provider: 'Gemini',
      priority: 2,
      status: 'error',
      message: error.message,
      cost: 'FREE (generous tier)'
    };
  }
}

async function testDeepSeek() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  if (!apiKey || apiKey === 'your-deepseek-key-here') {
    return {
      provider: 'DeepSeek',
      priority: 3,
      status: 'not_configured',
      message: 'API key not set in .env file',
      cost: '$0.14/1M tokens'
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
        model: model,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 5
      })
    });

    if (response.status === 401) {
      return {
        provider: 'DeepSeek',
        priority: 3,
        status: 'invalid_key',
        message: 'Invalid API key',
        cost: '$0.14/1M tokens'
      };
    }

    if (response.status === 429) {
      return {
        provider: 'DeepSeek',
        priority: 3,
        status: 'quota_exceeded',
        message: 'Rate limit or quota exceeded',
        cost: '$0.14/1M tokens'
      };
    }

    if (response.ok) {
      return {
        provider: 'DeepSeek',
        priority: 3,
        status: 'working',
        message: `Successfully connected (model: ${model})`,
        cost: '$0.14/1M tokens'
      };
    }

    return {
      provider: 'DeepSeek',
      priority: 3,
      status: 'error',
      message: `HTTP ${response.status}: ${response.statusText}`,
      cost: '$0.14/1M tokens'
    };

  } catch (error) {
    return {
      provider: 'DeepSeek',
      priority: 3,
      status: 'error',
      message: error.message,
      cost: '$0.14/1M tokens'
    };
  }
}

async function testOllama() {
  const endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';

  try {
    // First test if server is running
    const healthResponse = await fetch(`${endpoint}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (!healthResponse.ok) {
      return {
        provider: 'Ollama',
        priority: 4,
        status: 'server_not_running',
        message: 'Server not responding (run: ollama serve)',
        cost: 'FREE (local)'
      };
    }

    const tags = await healthResponse.json();
    const hasModel = tags.models?.some(m => m.name.includes(model.split(':')[0]));

    if (!hasModel) {
      return {
        provider: 'Ollama',
        priority: 4,
        status: 'model_not_found',
        message: `Model not installed (run: ollama pull ${model})`,
        cost: 'FREE (local)'
      };
    }

    // Test actual generation
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: 'Test',
        stream: false
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return {
        provider: 'Ollama',
        priority: 4,
        status: 'working',
        message: `Successfully connected (model: ${model})`,
        cost: 'FREE (local)'
      };
    }

    return {
      provider: 'Ollama',
      priority: 4,
      status: 'error',
      message: `HTTP ${response.status}: ${response.statusText}`,
      cost: 'FREE (local)'
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        provider: 'Ollama',
        priority: 4,
        status: 'timeout',
        message: 'Connection timeout (server may be down)',
        cost: 'FREE (local)'
      };
    }

    return {
      provider: 'Ollama',
      priority: 4,
      status: 'error',
      message: error.message,
      cost: 'FREE (local)'
    };
  }
}

// ============================================================
// Run Tests
// ============================================================

console.log('\n📋 Checking .env file...\n');

const envPath = join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found!');
  console.log('\n📝 Next steps:');
  console.log('   1. Copy .env.example to .env');
  console.log('   2. Fill in your API keys');
  console.log('   3. Run this test again\n');
  process.exit(1);
}

console.log('✅ .env file found\n');

console.log('🧪 Testing providers (this may take 10-15 seconds)...\n');

const results = await Promise.all([
  testOpenAI(),
  testGemini(),
  testDeepSeek(),
  testOllama()
]);

// ============================================================
// Display Results
// ============================================================

console.log('═'.repeat(70));
console.log('  TEST RESULTS');
console.log('═'.repeat(70));
console.log();

const getStatusIcon = (status) => {
  switch (status) {
    case 'working': return '✅';
    case 'not_configured': return '⚙️';
    case 'invalid_key': return '🔑';
    case 'quota_exceeded': return '⚠️';
    case 'server_not_running': return '🔴';
    case 'model_not_found': return '📦';
    case 'timeout': return '⏱️';
    case 'error': return '❌';
    default: return '❓';
  }
};

for (const result of results) {
  const icon = getStatusIcon(result.status);
  console.log(`${icon} ${result.provider} (Priority ${result.priority})`);
  console.log(`   Status: ${result.status.toUpperCase()}`);
  console.log(`   Message: ${result.message}`);
  console.log(`   Cost: ${result.cost}`);
  console.log();
}

// ============================================================
// Summary & Recommendations
// ============================================================

const workingProviders = results.filter(r => r.status === 'working');
const configuredProviders = results.filter(r => r.status !== 'not_configured');

console.log('═'.repeat(70));
console.log('  SUMMARY');
console.log('═'.repeat(70));
console.log();

console.log(`✅ Working providers: ${workingProviders.length}/4`);
console.log(`⚙️  Configured providers: ${configuredProviders.length}/4`);
console.log();

if (workingProviders.length === 0) {
  console.log('❌ NO PROVIDERS WORKING');
  console.log('\n⚠️  CRITICAL: SOMA cannot run federated learning without at least one provider!\n');
  console.log('📝 Next steps:');
  console.log('   1. Configure at least one API provider in .env');
  console.log('   2. Recommended: Start with Gemini (FREE tier)');
  console.log('      - Visit: https://aistudio.google.com/app/apikey');
  console.log('      - Copy key to .env: GEMINI_API_KEY=...');
  console.log('   3. Run this test again\n');
} else if (workingProviders.length === 1) {
  console.log(`⚠️  SINGLE PROVIDER MODE (${workingProviders[0].provider})`);
  console.log('\n   Federated learning will work but without consensus validation.');
  console.log('   Recommendation: Configure at least 2 providers for better accuracy.\n');

  console.log('💡 Recommended next provider to add:');

  const notWorking = results.filter(r => r.status !== 'working');
  for (const provider of notWorking) {
    if (provider.status === 'not_configured') {
      console.log(`   - ${provider.provider}: ${provider.cost}`);

      if (provider.provider === 'Gemini') {
        console.log('     Setup: https://aistudio.google.com/app/apikey');
      } else if (provider.provider === 'OpenAI') {
        console.log('     Setup: https://platform.openai.com/api-keys');
      } else if (provider.provider === 'DeepSeek') {
        console.log('     Setup: https://platform.deepseek.com/');
      } else if (provider.provider === 'Ollama') {
        console.log('     Setup: https://ollama.com/download');
      }
      break;
    }
  }
  console.log();

} else if (workingProviders.length >= 2) {
  console.log('✅ MULTI-PROVIDER MODE READY');
  console.log('\n   Federated learning configured with weighted consensus!');
  console.log(`   ${workingProviders.length} providers will cross-validate insights.\n`);

  console.log('🎯 Provider Rotation Order:');
  for (const provider of workingProviders.sort((a, b) => a.priority - b.priority)) {
    console.log(`   ${provider.priority}. ${provider.provider} → Fallback to next on quota/error`);
  }
  console.log();

  console.log('🚀 Ready to run SOMA!');
  console.log('   Command: node soma-bootstrap.js');
  console.log('   Nighttime learning will start automatically at 22:00\n');
}

// Show specific fixes for broken providers
const brokenProviders = results.filter(r =>
  r.status !== 'working' && r.status !== 'not_configured'
);

if (brokenProviders.length > 0) {
  console.log('🔧 FIXES FOR BROKEN PROVIDERS:\n');

  for (const provider of brokenProviders) {
    console.log(`   ${provider.provider}:`);

    if (provider.status === 'invalid_key') {
      console.log('      1. Check API key in .env is correct');
      console.log('      2. Verify key has not expired');
      console.log('      3. Generate new key if needed');
    } else if (provider.status === 'quota_exceeded') {
      console.log('      1. Wait for quota to reset (usually daily/monthly)');
      console.log('      2. Check billing settings');
      console.log('      3. Consider upgrading to paid tier');
    } else if (provider.status === 'server_not_running' && provider.provider === 'Ollama') {
      console.log('      1. Run: ollama serve');
      console.log('      2. Or start Ollama app (auto-starts server)');
      console.log('      3. Check Windows Firewall allows localhost:11434');
    } else if (provider.status === 'model_not_found' && provider.provider === 'Ollama') {
      console.log(`      1. Run: ollama pull ${process.env.OLLAMA_MODEL || 'llama3.1:8b'}`);
      console.log('      2. Wait for download to complete');
      console.log('      3. Run this test again');
    } else if (provider.status === 'timeout') {
      console.log('      1. Check server is running');
      console.log('      2. Verify endpoint URL in .env');
      console.log('      3. Check firewall/network settings');
    }

    console.log();
  }
}

console.log('═'.repeat(70));

process.exit(workingProviders.length === 0 ? 1 : 0);
