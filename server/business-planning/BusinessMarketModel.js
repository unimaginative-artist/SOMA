const clamp = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const pct = value => clamp(value, 0, 0, 100) / 100;

export const DEFAULT_MARKET_ASSUMPTIONS = Object.freeze({
    totalPotentialCustomers: 0,
    annualSpendPerCustomer: 0,
    serviceableGeographyPct: 25,
    targetSegmentPct: 20,
    year3ObtainableSharePct: 1,
    annualMarketGrowthPct: 4,
    sourceRefs: { totalPotentialCustomers: [], annualSpendPerCustomer: [], annualMarketGrowthPct: [] }
});

export function normalizeMarketAssumptions(input = {}) {
    const refs = input.sourceRefs || {};
    return {
        totalPotentialCustomers: clamp(input.totalPotentialCustomers, DEFAULT_MARKET_ASSUMPTIONS.totalPotentialCustomers, 0, 1e10),
        annualSpendPerCustomer: clamp(input.annualSpendPerCustomer, DEFAULT_MARKET_ASSUMPTIONS.annualSpendPerCustomer, 0, 1e9),
        serviceableGeographyPct: clamp(input.serviceableGeographyPct, DEFAULT_MARKET_ASSUMPTIONS.serviceableGeographyPct, 0, 100),
        targetSegmentPct: clamp(input.targetSegmentPct, DEFAULT_MARKET_ASSUMPTIONS.targetSegmentPct, 0, 100),
        year3ObtainableSharePct: clamp(input.year3ObtainableSharePct, DEFAULT_MARKET_ASSUMPTIONS.year3ObtainableSharePct, 0, 100),
        annualMarketGrowthPct: clamp(input.annualMarketGrowthPct, DEFAULT_MARKET_ASSUMPTIONS.annualMarketGrowthPct, -100, 1000),
        sourceRefs: Object.fromEntries(['totalPotentialCustomers', 'annualSpendPerCustomer', 'annualMarketGrowthPct'].map(key => [key, [...new Set((Array.isArray(refs[key]) ? refs[key] : []).map(String))].slice(0, 8)]))
    };
}

function confidenceFor(assumptions, evidence = {}) {
    const sourceById = new Map((evidence.sources || []).map(source => [source.id, source]));
    const coreFields = ['totalPotentialCustomers', 'annualSpendPerCustomer', 'annualMarketGrowthPct'];
    const cited = coreFields.filter(field => assumptions.sourceRefs[field].some(id => sourceById.has(id)));
    const authoritative = coreFields.filter(field => assumptions.sourceRefs[field].some(id => sourceById.get(id)?.authoritative));
    const coverage = cited.length / coreFields.length;
    const authorityCoverage = authoritative.length / coreFields.length;
    const score = Math.round(Math.min(95, 20 + coverage * 45 + authorityCoverage * 25 + (evidence.status === 'live_sources_found' ? 5 : 0)));
    return {
        score,
        label: score >= 80 ? 'strong evidence coverage' : score >= 55 ? 'partial evidence coverage' : 'assumption-led',
        coverage: money(coverage), authorityCoverage: money(authorityCoverage),
        basis: 'Derived from citation coverage and source authority; never from an LLM self-rating.'
    };
}

export function buildMarketSizingModel(input = {}, evidence = {}, financialModel = null) {
    const assumptions = normalizeMarketAssumptions(input);
    const tam = assumptions.totalPotentialCustomers * assumptions.annualSpendPerCustomer;
    const serviceableCustomers = assumptions.totalPotentialCustomers * pct(assumptions.serviceableGeographyPct) * pct(assumptions.targetSegmentPct);
    const sam = serviceableCustomers * assumptions.annualSpendPerCustomer;
    const som = sam * pct(assumptions.year3ObtainableSharePct);
    const bottomUpYear3 = financialModel?.scenarios?.base?.annual?.[2]?.revenue ?? null;
    const divergencePct = bottomUpYear3 !== null && som > 0 ? Math.abs(bottomUpYear3 - som) / som * 100 : null;
    const warnings = [];
    if (!assumptions.sourceRefs.totalPotentialCustomers.length) warnings.push('Total potential customers has no linked evidence source.');
    if (!assumptions.sourceRefs.annualSpendPerCustomer.length) warnings.push('Annual customer spend has no linked evidence source.');
    if (assumptions.year3ObtainableSharePct > 5) warnings.push('Year-three obtainable share exceeds 5%; validate capacity and channel assumptions carefully.');
    if (divergencePct !== null && divergencePct > 50) warnings.push('Top-down SOM and bottom-up year-three revenue differ by more than 50%.');
    return {
        currency: 'USD', assumptions,
        tam: money(tam), sam: money(sam), som: money(som), serviceableCustomers: money(serviceableCustomers),
        bottomUpYear3: bottomUpYear3 === null ? null : money(bottomUpYear3),
        divergencePct: divergencePct === null ? null : money(divergencePct),
        confidence: confidenceFor(assumptions, evidence), warnings,
        methodology: {
            tam: 'Total potential customers × annual spend per customer.',
            sam: 'TAM × serviceable geography share × target segment share.',
            som: 'SAM × founder-entered year-three obtainable share.',
            bottomUp: 'Year-three revenue from the deterministic monthly operating model.'
        },
        calculatedAt: new Date().toISOString()
    };
}

export const DEFAULT_PRICING_TIERS = Object.freeze([
    { id: 'core', name: 'Core', price: 100, materialCost: 10, laborCost: 10, fulfillmentCost: 5, commissionPct: 5, warrantyReservePct: 2, monthlyVolume: 60 },
    { id: 'premium', name: 'Premium', price: 175, materialCost: 16, laborCost: 20, fulfillmentCost: 8, commissionPct: 5, warrantyReservePct: 2, monthlyVolume: 25 },
    { id: 'partner', name: 'Partner / Volume', price: 80, materialCost: 8, laborCost: 8, fulfillmentCost: 4, commissionPct: 3, warrantyReservePct: 2, monthlyVolume: 15 }
]);

export function defaultPricingTiersForFinancial(financial = {}) {
    const price = clamp(financial.monthlyPrice, 100, 0, 1e9);
    const directCost = clamp(financial.variableCostPerCustomer, price * 0.25, 0, 1e9);
    const split = value => ({ materialCost: money(value * 0.45), laborCost: money(value * 0.35), fulfillmentCost: money(value * 0.20) });
    return [
        { id:'core', name:'Core assumption', price, ...split(directCost), commissionPct:5, warrantyReservePct:2, monthlyVolume:60 },
        { id:'premium', name:'Premium test', price:money(price * 1.5), ...split(directCost * 1.25), commissionPct:5, warrantyReservePct:2, monthlyVolume:25 },
        { id:'partner', name:'Partner / volume test', price:money(price * 0.8), ...split(directCost * 0.85), commissionPct:3, warrantyReservePct:2, monthlyVolume:15 }
    ];
}

export function normalizePricingTiers(input = []) {
    const source = Array.isArray(input) && input.length ? input : DEFAULT_PRICING_TIERS;
    return source.slice(0, 8).map((tier, index) => ({
        id: String(tier.id || `tier-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60),
        name: String(tier.name || `Tier ${index + 1}`).slice(0, 120),
        price: clamp(tier.price, 0, 0, 1e9), materialCost: clamp(tier.materialCost, 0, 0, 1e9),
        laborCost: clamp(tier.laborCost, 0, 0, 1e9), fulfillmentCost: clamp(tier.fulfillmentCost, 0, 0, 1e9),
        commissionPct: clamp(tier.commissionPct, 0, 0, 100), warrantyReservePct: clamp(tier.warrantyReservePct, 0, 0, 100),
        monthlyVolume: clamp(tier.monthlyVolume, 0, 0, 1e9)
    }));
}

export function buildPricingModel(input = [], options = {}) {
    const tiers = normalizePricingTiers(input).map(tier => {
        const directCosts = tier.materialCost + tier.laborCost + tier.fulfillmentCost;
        const grossProfit = tier.price - directCosts;
        const variableSellingCosts = tier.price * (tier.commissionPct + tier.warrantyReservePct) / 100;
        const contributionProfit = grossProfit - variableSellingCosts;
        return { ...tier, directCosts: money(directCosts), grossProfit: money(grossProfit), grossMarginPct: tier.price ? money(grossProfit / tier.price * 100) : 0, contributionProfit: money(contributionProfit), contributionMarginPct: tier.price ? money(contributionProfit / tier.price * 100) : 0, monthlyContribution: money(contributionProfit * tier.monthlyVolume) };
    });
    const totalVolume = tiers.reduce((sum, tier) => sum + tier.monthlyVolume, 0);
    const weighted = key => totalVolume ? tiers.reduce((sum, tier) => sum + tier[key] * tier.monthlyVolume, 0) / totalVolume : 0;
    const averagePrice = money(weighted('price'));
    const averageDirectCosts = money(weighted('directCosts'));
    const averageContribution = money(weighted('contributionProfit'));
    const cac = clamp(options.customerAcquisitionCost, 0, 0, 1e9);
    const churn = clamp(options.monthlyChurnPct, 0, 0, 100) / 100;
    const ltv = churn > 0 ? averageContribution / churn : null;
    return {
        tiers, mixTotal: totalVolume, weightedAveragePrice: averagePrice, weightedAverageDirectCosts: averageDirectCosts,
        weightedGrossMarginPct: averagePrice ? money((averagePrice - averageDirectCosts) / averagePrice * 100) : 0,
        weightedContribution: averageContribution, customerAcquisitionCost: cac,
        ltv: ltv === null ? null : money(ltv), ltvCacRatio: ltv !== null && cac > 0 ? money(ltv / cac) : null,
        cacPaybackMonths: averageContribution > 0 && cac > 0 ? money(cac / averageContribution) : null,
        warnings: tiers.filter(tier => tier.contributionProfit < 0).map(tier => `${tier.name} has negative contribution profit.`),
        methodology: 'Weighted by the entered monthly unit mix. LTV uses monthly contribution divided by monthly churn.',
        calculatedAt: new Date().toISOString()
    };
}

export function buildSensitivityAnalysis(financialAssumptions = {}, marketAssumptions = {}, pricingTiers = []) {
    const priceFactors = [0.85, 1, 1.15];
    const volumeFactors = [0.7, 1, 1.3];
    const pricing = buildPricingModel(pricingTiers, financialAssumptions);
    const fixed = clamp(financialAssumptions.fixedMonthlyCosts, 0);
    const cells = volumeFactors.flatMap(volumeFactor => priceFactors.map(priceFactor => {
        const revenue = pricing.tiers.reduce((sum, tier) => sum + tier.price * priceFactor * tier.monthlyVolume * volumeFactor, 0);
        const costs = pricing.tiers.reduce((sum, tier) => sum + (tier.directCosts + tier.price * priceFactor * (tier.commissionPct + tier.warrantyReservePct) / 100) * tier.monthlyVolume * volumeFactor, 0) + fixed;
        return { priceFactor, volumeFactor, monthlyRevenue: money(revenue), monthlyOperatingProfit: money(revenue - costs) };
    }));
    return { priceFactors, volumeFactors, cells, marketShareCases: [0.5, 1, 2].map(factor => ({ factor, year3Som: money(buildMarketSizingModel({ ...marketAssumptions, year3ObtainableSharePct: clamp(marketAssumptions.year3ObtainableSharePct, 1) * factor }).som) })), calculatedAt: new Date().toISOString() };
}

export default buildMarketSizingModel;
