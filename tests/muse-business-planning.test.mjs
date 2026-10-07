import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildBusinessPlanPrompt, businessPlanFilename, extractBusinessPlanResponse,
  missingRequiredFields, profileCompleteness,
} from '../frontend/apps/command-bridge/components/muse/businessPlanService.js';

const ROOT = process.cwd();
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Muse contains Business Planning and presents legacy Studio as Workshop', () => {
  const muse = read('frontend/apps/command-bridge/components/SomaMuseMode.jsx');
  const room = read('frontend/apps/command-bridge/components/muse/BusinessPlanningRoom.jsx');
  const bridge = read('frontend/apps/command-bridge/SomaCommandBridge.jsx');

  assert.match(muse, /id:'studio',\s+label:'workshop'/);
  assert.match(muse, /id:'studio',\s+name:'Workshop'/);
  assert.match(muse, /id:'business',\s+label:'business planning'/);
  assert.match(muse, /room === 'business'[\s\S]{0,220}<BusinessPlanningRoom/);
  assert.match(room, /somaBackend\.createBusinessPlan/);
  assert.match(room, /somaBackend\.getBusinessPlanJob/);
  assert.match(room, /Specialists work in parallel/);
  assert.match(room, /the job continues on SOMA’s server/);
  assert.match(room, /build with SOMA/);
  assert.match(room, /preview proposal/);
  assert.match(room, /applyBusinessPlanRevision/);
  assert.match(room, /Brainstorm freely, explore what-if scenarios/);
  assert.match(room, /localStorage\.setItem\(STORAGE_KEY/);
  assert.doesNotMatch(bridge, /id:\s*['"]business_plan['"]/);
  assert.doesNotMatch(bridge, /BusinessPlannerApp/);
});

test('Muse business planning uses a server-side council job contract', () => {
  const backend = read('frontend/apps/command-bridge/somaBackend.js');
  const somaRoutes = read('server/routes/somaRoutes.js');
  const routes = read('server/routes/businessPlanRoutes.js');
  const orchestrator = read('server/business-planning/BusinessPlanOrchestrator.js');
  const room = read('frontend/apps/command-bridge/components/muse/BusinessPlanningRoom.jsx');

  assert.match(backend, /createBusinessPlan\(profile/);
  assert.match(backend, /getBusinessPlanJob\(jobId/);
  assert.match(somaRoutes, /router\.use\('\/business-plans'/);
  assert.match(routes, /res\.status\(202\)/);
  assert.match(orchestrator, /Promise\.allSettled\(SPECIALISTS/);
  assert.match(orchestrator, /devilsAdvocate/);
  assert.match(orchestrator, /system\.crona/);
  assert.match(orchestrator, /quality_gate/);
  assert.match(orchestrator, /BusinessEvidenceService/);
  assert.match(orchestrator, /createRevision\(id, request, mode/);
  assert.match(orchestrator, /_selectRevisionSpecialists/);
  assert.match(orchestrator, /_classifyCollaborationIntent/);
  assert.match(orchestrator, /business_planning_exploration/);
  assert.match(orchestrator, /versions\.push/);
  assert.match(routes, /revisions\/:revisionId\/apply/);
  assert.match(routes, /versions\/:version\/restore/);
  assert.match(routes, /:id\/scenarios/);
  assert.match(routes, /:id\/operations/);
  assert.match(room, /explore idea/);
  assert.match(room, /change plan/);
  assert.match(room, /BusinessWorkspacePanels/);
  assert.match(room, /market \+ pricing/);
  assert.match(room, /downloadBusinessPlanExport/);
  assert.match(room, /prepareBusinessPlanArbiteriumHandoff/);
  assert.match(routes, /:id\/model\/recalibrate/);
  assert.match(routes, /:id\/model\/preview/);
  assert.match(routes, /:id\/exports\/:format/);
  assert.match(routes, /:id\/arbiterium-handoff/);
});

test('Muse business plan prompt is grounded and structured', () => {
  const profile = {
    businessName:'Northstar', concept:'Planning software for contractors', customer:'Small trade contractors',
    problem:'Quotes and schedules live in disconnected tools', solution:'One operational workspace',
    revenueModel:'Monthly subscription', stage:'validation', geography:'United States',
    founderAdvantages:'Industry experience', goals:'Reach 20 paid customers', constraints:'Bootstrapped',
  };
  const prompt = buildBusinessPlanPrompt(profile);
  assert.equal(profileCompleteness(profile), 100);
  assert.deepEqual(missingRequiredFields(profile), []);
  assert.match(prompt, /# Northstar/);
  assert.match(prompt, /## Financial Framework/);
  assert.match(prompt, /Never invent citations, customers, traction/);
  assert.deepEqual(missingRequiredFields({ concept:'x' }), ['Ideal customer', 'Customer problem']);
  assert.equal(extractBusinessPlanResponse({ response:'  # Plan  ' }), '# Plan');
  assert.equal(businessPlanFilename('Northstar & Sons!'), 'northstar-sons-business-plan.md');
});
