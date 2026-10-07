// Load .env file before running smoke test
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from root
const envPath = join(__dirname, '../../.env');
const envFile = readFileSync(envPath, 'utf8');

// Parse and set environment variables
envFile.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;

  const [key, ...valueParts] = line.split('=');
  const value = valueParts.join('=');

  if (key && value) {
    process.env[key] = value;
  }
});

console.log('✅ Loaded .env file');
console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET'}`);

// Now run the smoke test
import('./smoke-test.mjs');
