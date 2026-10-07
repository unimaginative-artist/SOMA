#!/usr/bin/env node

const baseUrl = process.env.SOMA_BASE_URL || 'http://127.0.0.1:3001';
const timeoutMs = Number.parseInt(process.env.SOMA_HEALTH_TIMEOUT_MS || '5000', 10);

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { path, status: response.status, ok: response.ok, body };
  } catch (error) {
    return { path, status: 0, ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(result) {
  if (result.error) return `${result.path}: ERROR ${result.error}`;
  const status = result.ok ? 'OK' : 'FAIL';
  const marker = result.body?.ok === false ? 'not-ready' : result.body?.status || result.body?.enabled;
  return `${result.path}: ${status} ${result.status}${marker !== undefined ? ` (${marker})` : ''}`;
}

const checks = [
  '/health',
  '/api/health',
  '/api/autopilot/status',
  '/api/autonomy/health'
];

const results = await Promise.all(checks.map(fetchJson));
for (const result of results) {
  console.log(summarize(result));
}

const autonomy = results.find(r => r.path === '/api/autonomy/health');
const failed = results.filter(r => !r.ok);

if (autonomy?.body?.checks) {
  const badChecks = Object.entries(autonomy.body.checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (badChecks.length) {
    console.error(`autonomy failed checks: ${badChecks.join(', ')}`);
  }
}

if (failed.length || autonomy?.body?.ok !== true) {
  process.exitCode = 1;
} else {
  console.log('SOMA autonomy health verified.');
}
