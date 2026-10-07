'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('Graphify excludes reference repos and generated browser payloads from SOMA architecture', () => {
  const ignore = fs.readFileSync('.graphifyignore', 'utf8');
  for (const required of [
    '*_repo/', 'clawdbot_repo/', 'workflowagent_repo/', 'librechat_repo/',
    'nofx_repo/', 'arbiterium_source/', 'research/', 'unsloth_compiled_cache/', '**/*.min.mjs'
  ]) assert.match(ignore, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('SOMA Graphify rebuild explicitly adds CommonJS architecture support', () => {
  const source = fs.readFileSync('scripts/rebuild-soma-graphify.py', 'utf8');
  assert.match(source, /CODE_EXTENSIONS\.add\('\.cjs'\)/);
  assert.match(source, /_DISPATCH\['\.cjs'\] = extract_module\.extract_js/);
  assert.match(source, /parallel=False/);
});
