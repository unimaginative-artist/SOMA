import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArchitectureTruthMapService, renderArchitectureTruthMapMarkdown } from '../core/ArchitectureTruthMapService.js';

test('architecture truth map separates runtime evidence from static presence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-truth-map-'));
  await fs.mkdir(path.join(root, 'data', 'architecture-census'), { recursive:true });
  await fs.mkdir(path.join(root, 'data', 'self-evolution'), { recursive:true });
  await fs.mkdir(path.join(root, 'core'), { recursive:true });
  await fs.mkdir(path.join(root, 'server', 'routes'), { recursive:true });
  await fs.mkdir(path.join(root, 'tests'), { recursive:true });
  await fs.writeFile(path.join(root, 'core', 'ToolRegistry.js'), 'export class ToolRegistry { getToolsManifest(){ return []; } async execute(){} }');
  await fs.writeFile(path.join(root, 'server', 'routes', 'x.js'), "router.get('/api/x', () => system.visibleEngine.run())");
  await fs.writeFile(path.join(root, 'tests', 'x.test.mjs'), 'visibleEngine');
  await fs.writeFile(path.join(root, 'data', 'architecture-census', 'latest.json'), JSON.stringify({ filesClassified:2, summary:{ candidate_unused:1, duplicate_named:0, stubbed:0 }, entries:[{ path:'core/Hidden.js', classification:'candidate_unused', lines:50, tags:[], evidence:'0 inbound' }] }));
  await fs.writeFile(path.join(root, 'data', 'self-evolution', 'scoreboard.json'), JSON.stringify({ domains:{ planning:{ valid:true, tests:2, passed:2, failed:0, score:1, completedAt:'2026-01-01', evidenceHash:'abc' } } }));
  const runtime = { ready:true, generatedAt:'2026-01-01', components:[{ id:'visibleEngine', name:'VisibleEngine', type:'engine', status:'active' }, { id:'hiddenThing', name:'HiddenThing', type:'component', status:'active' }], counts:{ components:2 }, expertises:{ packages:[], status:{ ready:true } }, readiness:{ packages:[] } };
  const report = await new ArchitectureTruthMapService({ root }).build({ runtimeSnapshot:runtime, toolSnapshot:{ tools:[{ name:'x' }] }, autonomySnapshot:{ scoreboard:{ verifiedCompletions:2, failedMissions:3, completionRate:40, weakestArea:'engineering' } }, persist:false });
  assert.equal(report.runtimeComponents.find(item => item.id === 'visibleEngine').truthStatus, 'operational_verified_surface');
  assert.equal(report.runtimeComponents.find(item => item.id === 'hiddenThing').truthStatus, 'operational_internal_only');
  assert.equal(report.summary.dormantCandidates, 1);
  assert.equal(report.summary.toolTelemetryReliable, false);
  assert.equal(report.summary.missionCompletionRate, 40);
  assert.match(renderArchitectureTruthMapMarkdown(report), /SOMA Architecture Truth Map/);
  await fs.rm(root, { recursive:true, force:true });
});
