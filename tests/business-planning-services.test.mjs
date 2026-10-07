import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialModel, normalizeFinancialAssumptions } from '../server/business-planning/BusinessFinancialModel.js';
import { BusinessEvidenceService } from '../server/business-planning/BusinessEvidenceService.js';
import { buildMarketSizingModel, buildPricingModel, buildSensitivityAnalysis } from '../server/business-planning/BusinessMarketModel.js';
import { buildBusinessPlanWorkbook, buildPitchDeckHtml } from '../server/business-planning/BusinessPlanExportService.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

test('deterministic financial model calculates repeatable 36-month scenarios and warnings', () => {
  const assumptions = normalizeFinancialAssumptions({ startingCapital:'5000', startingCustomers:10, monthlyPrice:100, monthlyCustomerGrowthPct:5, monthlyChurnPct:8 });
  const first = buildFinancialModel(assumptions);
  const second = buildFinancialModel(assumptions);
  assert.deepEqual(first.scenarios.base.annual, second.scenarios.base.annual);
  assert.equal(first.scenarios.base.monthly.length, 36);
  assert.equal(first.assumptions.startingCapital, 5000);
  assert.ok(first.warnings.some(item => /growth does not exceed churn/i.test(item)));
  assert.ok(first.scenarios.conservative.annual[0].revenue <= first.scenarios.upside.annual[0].revenue);
});

test('evidence service uses live search fallback, categories sources, and creates stable citations', async () => {
  const queries = [];
  const service = new BusinessEvidenceService({
    braveSearch: { async searchWeb(query) { queries.push(query); return { success:true, results:[{ title:'SBA resource', url:'https://www.sba.gov/funding-programs/loans', snippet:'Official loan program overview.' }] }; } },
  }, { researchService:{ isConfigured:() => false }, now:() => 1000 });
  const result = await service.research({ concept:'mobile bakery', geography:'Ohio', solution:'food truck' });
  assert.equal(queries.length, 9);
  assert.equal(result.sources.length, 1, 'the same URL is deduplicated across research categories');
  assert.equal(result.sources[0].id, 'S1');
  assert.equal(result.sources[0].authoritative, true);
  assert.match(result.disclaimer, /does not access bank accounts/i);
});

test('market sizing derives values and confidence from linked evidence', () => {
  const evidence = { status:'live_sources_found', sources:[{ id:'S1', authoritative:true }, { id:'S2', authoritative:false }] };
  const market = buildMarketSizingModel({ totalPotentialCustomers:10000, annualSpendPerCustomer:1200, serviceableGeographyPct:50, targetSegmentPct:20, year3ObtainableSharePct:2, sourceRefs:{ totalPotentialCustomers:['S1'], annualSpendPerCustomer:['S2'] } }, evidence);
  assert.equal(market.tam, 12000000);
  assert.equal(market.sam, 1200000);
  assert.equal(market.som, 24000);
  assert.equal(market.confidence.score, 63);
  assert.match(market.confidence.basis, /never from an LLM/i);
});

test('pricing, sensitivity, workbook, and pitch deck remain deterministic', () => {
  const tiers = [{ id:'core', name:'Core', price:100, materialCost:20, laborCost:10, fulfillmentCost:5, commissionPct:5, warrantyReservePct:2, monthlyVolume:10 }];
  const pricing = buildPricingModel(tiers, { customerAcquisitionCost:100, monthlyChurnPct:5 });
  assert.equal(pricing.tiers[0].grossProfit, 65);
  assert.equal(pricing.tiers[0].contributionProfit, 58);
  assert.equal(pricing.ltvCacRatio, 11.6);
  const sensitivity = buildSensitivityAnalysis({ fixedMonthlyCosts:500, customerAcquisitionCost:100, monthlyChurnPct:5 }, { totalPotentialCustomers:1000, annualSpendPerCustomer:100 }, tiers);
  assert.equal(sensitivity.cells.length, 9);
  const job = { profile:{ businessName:'Northstar', concept:'A grounded company', customer:'Builders', problem:'Waste', solution:'Workflow' }, marketModel:buildMarketSizingModel({ totalPotentialCustomers:1000, annualSpendPerCustomer:100 }), pricingModel:pricing, sensitivityAnalysis:sensitivity, financialModel:buildFinancialModel({}), evidence:{ sources:[] }, operatingWorkspace:{ milestones:[], decisions:[] } };
  const workbook = XLSX.read(buildBusinessPlanWorkbook(job));
  assert.ok(workbook.SheetNames.includes('Market Sizing'));
  assert.ok(workbook.SheetNames.includes('Evidence Ledger'));
  assert.match(buildPitchDeckHtml(job), /Evidence-backed opportunity/);
  assert.match(buildPitchDeckHtml(job), /Northstar/);
});
