#!/usr/bin/env node
// SOMA Health Check - Run this to verify everything is working
// Usage: node health-check.cjs

const http = require('http');

console.log('🏥 SOMA Health Check Starting...\n');

const checks = [
  { name: 'Backend HTTP', port: 3001, path: '/health', timeout: 5000 },
  // SOMA CT is an embedded Command Bridge module. Its real release contract is
  // the served Command Bridge shell plus CT's shared conversation endpoint on
  // the authoritative backend—not the retired standalone server on port 4200.
  { name: 'Command Bridge UI', port: 3001, path: '/', timeout: 5000, expectedIncludes: '<title>SOMA Command Bridge' },
  { name: 'SOMA CT continuity API', port: 3001, path: '/api/soma/history?sessionId=soma-health-check&limit=1', timeout: 5000, expectedIncludes: '"success"' }
];

async function checkEndpoint(check) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const req = http.get(`http://localhost:${check.port}${check.path}`, (res) => {
      const elapsed = Date.now() - startTime;
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const bodyMatches = !check.expectedIncludes || data.includes(check.expectedIncludes);
        if (res.statusCode === 200 && bodyMatches) {
          resolve({
            ...check,
            status: 'OK',
            elapsed,
            message: `✅ ${check.name} responding in ${elapsed}ms`
          });
        } else {
          resolve({
            ...check,
            status: 'ERROR',
            elapsed,
            message: res.statusCode !== 200
              ? `❌ ${check.name} returned status ${res.statusCode}`
              : `❌ ${check.name} returned the wrong application contract`
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        ...check,
        status: check.optional ? 'OPTIONAL_DOWN' : 'DOWN',
        elapsed: 0,
        message: check.optional
          ? `⚠️  ${check.name} not running (optional compatibility service)`
          : `❌ ${check.name} not responding (${err.message})`
      });
    });

    req.setTimeout(check.timeout, () => {
      req.destroy();
      resolve({
        ...check,
        status: 'TIMEOUT',
        elapsed: check.timeout,
        message: `⚠️  ${check.name} TIMEOUT after ${check.timeout}ms - SERVER IS HUNG!`
      });
    });
  });
}

async function main() {
  const results = await Promise.all(checks.map(checkEndpoint));

  console.log('📊 Health Check Results:\n');
  results.forEach(result => {
    console.log(result.message);
  });

  const hasTimeout = results.some(r => r.status === 'TIMEOUT');
  const hasError = results.some(r => !r.optional && (r.status === 'ERROR' || r.status === 'DOWN'));

  console.log('\n' + '='.repeat(60));

  if (hasTimeout) {
    console.log('🚨 CRITICAL: Server is HUNG and needs to be restarted!');
    console.log('\nTo fix:');
    console.log('1. Run: taskkill /F /IM node.exe /T');
    console.log('2. Run: npm run start:all');
    process.exit(2);
  } else if (hasError) {
    console.log('⚠️  Some services are not running properly');
    console.log('\nCheck if all services started correctly.');
    process.exit(1);
  } else {
    console.log('✅ All systems operational!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Health check failed:', err);
  process.exit(1);
});
