import { ExpertiseRegistry } from '../core/ExpertiseRegistry.js';

const registry = new ExpertiseRegistry({ system: {}, rootPath: process.cwd() });
await registry.initialize();

const auditMatches = registry.match('audit duplicate invoice footing reconciliation GAAP');
const oncologyMatches = registry.match('oncology cancer tumor chemotherapy NCCN');
const auditLoad = await registry.load('finance/audit', { level: 'hot' });

const result = {
    ok: registry.status().manifests >= 5 &&
        auditMatches.some(match => match.id === 'finance/audit') &&
        oncologyMatches.some(match => match.id === 'healthcare/oncology') &&
        auditLoad.success,
    status: registry.status(),
    auditTopMatch: auditMatches[0]?.id || null,
    oncologyTopMatch: oncologyMatches[0]?.id || null,
    loadedAudit: auditLoad.status?.name || auditLoad.id
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);
