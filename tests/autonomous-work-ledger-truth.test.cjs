const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('verified-work summary excludes observed progress and self-referential proactive prose', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ledger-'));
  try {
    const file = path.join(root, 'SOMA', 'autonomous-work-ledger.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
      { type: 'goal_progress', title: 'Observed', summary: 'observation 36', evidence: 'tools=read_file', status: 'observed', source: 'test' },
      { type: 'proactive_update', title: 'Prose', summary: 'I pushed a change', evidence: { grounding: 'model' }, status: 'reported', source: 'test' },
      { type: 'goal_completion', title: 'Verified', summary: 'Tests passed', evidence: { receiptId: 'r1' }, status: 'verified', source: 'test' }
    ] }));
    const modulePath = path.resolve(__dirname, '../core/AutonomousWorkLedger.cjs');
    const summary = execFileSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(modulePath)}).summarize(8))`], { cwd: root, encoding: 'utf8' });
    assert.match(summary, /Verified/);
    assert.doesNotMatch(summary, /observation 36|pushed a change/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
