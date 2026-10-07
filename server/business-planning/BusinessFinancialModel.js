const DEFAULTS = Object.freeze({
    startingCapital: 5000,
    startingCustomers: 5,
    monthlyPrice: 100,
    monthlyCustomerGrowthPct: 12,
    monthlyChurnPct: 3,
    grossMarginPct: 70,
    fixedMonthlyCosts: 2500,
    variableCostPerCustomer: 10,
    customerAcquisitionCost: 250,
    oneTimeStartupCosts: 3500,
    annualHiringCosts: [0, 45000, 90000],
    taxRatePct: 21
});

const number = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const money = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function normalizeFinancialAssumptions(input = {}) {
    const hiring = Array.isArray(input.annualHiringCosts) ? input.annualHiringCosts : DEFAULTS.annualHiringCosts;
    return {
        startingCapital: number(input.startingCapital, DEFAULTS.startingCapital, 0, 1e9),
        startingCustomers: number(input.startingCustomers, DEFAULTS.startingCustomers, 0, 1e7),
        monthlyPrice: number(input.monthlyPrice, DEFAULTS.monthlyPrice, 0, 1e7),
        monthlyCustomerGrowthPct: number(input.monthlyCustomerGrowthPct, DEFAULTS.monthlyCustomerGrowthPct, -100, 1000),
        monthlyChurnPct: number(input.monthlyChurnPct, DEFAULTS.monthlyChurnPct, 0, 100),
        grossMarginPct: number(input.grossMarginPct, DEFAULTS.grossMarginPct, 0, 100),
        fixedMonthlyCosts: number(input.fixedMonthlyCosts, DEFAULTS.fixedMonthlyCosts, 0, 1e9),
        variableCostPerCustomer: number(input.variableCostPerCustomer, DEFAULTS.variableCostPerCustomer, 0, 1e7),
        customerAcquisitionCost: number(input.customerAcquisitionCost, DEFAULTS.customerAcquisitionCost, 0, 1e7),
        oneTimeStartupCosts: number(input.oneTimeStartupCosts, DEFAULTS.oneTimeStartupCosts, 0, 1e9),
        annualHiringCosts: [0, 1, 2].map(index => number(hiring[index], DEFAULTS.annualHiringCosts[index], 0, 1e9)),
        taxRatePct: number(input.taxRatePct, DEFAULTS.taxRatePct, 0, 100)
    };
}

function project(assumptions, months = 36) {
    let customers = assumptions.startingCustomers;
    let cash = assumptions.startingCapital - assumptions.oneTimeStartupCosts;
    let breakEvenMonth = null;
    const monthly = [];
    for (let index = 0; index < months; index += 1) {
        const year = Math.floor(index / 12);
        const acquired = customers * (assumptions.monthlyCustomerGrowthPct / 100);
        const churned = customers * (assumptions.monthlyChurnPct / 100);
        customers = Math.max(0, customers + acquired - churned);
        const revenue = customers * assumptions.monthlyPrice;
        const directCosts = Math.max(revenue * (1 - assumptions.grossMarginPct / 100), customers * assumptions.variableCostPerCustomer);
        const acquisitionCosts = acquired * assumptions.customerAcquisitionCost;
        const operatingCosts = assumptions.fixedMonthlyCosts + assumptions.annualHiringCosts[year] / 12 + acquisitionCosts;
        const operatingProfit = revenue - directCosts - operatingCosts;
        const tax = operatingProfit > 0 ? operatingProfit * assumptions.taxRatePct / 100 : 0;
        const netCashFlow = operatingProfit - tax;
        cash += netCashFlow;
        if (breakEvenMonth === null && operatingProfit >= 0) breakEvenMonth = index + 1;
        monthly.push({ month: index + 1, year: year + 1, customers: money(customers), customersAcquired: money(acquired), customersChurned: money(churned), revenue: money(revenue), directCosts: money(directCosts), acquisitionCosts: money(acquisitionCosts), operatingCosts: money(operatingCosts), operatingProfit: money(operatingProfit), tax: money(tax), netCashFlow: money(netCashFlow), endingCash: money(cash) });
    }
    const annual = [1, 2, 3].map(year => {
        const periods = monthly.filter(item => item.year === year);
        const sum = key => money(periods.reduce((total, item) => total + item[key], 0));
        return { year, endingCustomers: periods.at(-1)?.customers || 0, revenue: sum('revenue'), directCosts: sum('directCosts'), operatingCosts: sum('operatingCosts'), operatingProfit: sum('operatingProfit'), netCashFlow: sum('netCashFlow'), endingCash: periods.at(-1)?.endingCash || 0 };
    });
    const firstNegativeCash = monthly.find(item => item.endingCash < 0)?.month || null;
    return { monthly, annual, breakEvenMonth, runwayMonths: firstNegativeCash ? firstNegativeCash - 1 : null, endingCash: monthly.at(-1)?.endingCash || cash };
}

function vary(base, growthMultiplier, priceMultiplier, costMultiplier) {
    return normalizeFinancialAssumptions({
        ...base,
        monthlyCustomerGrowthPct: base.monthlyCustomerGrowthPct * growthMultiplier,
        monthlyPrice: base.monthlyPrice * priceMultiplier,
        fixedMonthlyCosts: base.fixedMonthlyCosts * costMultiplier,
        annualHiringCosts: base.annualHiringCosts.map(value => value * costMultiplier)
    });
}

export function buildFinancialModel(input = {}, options = {}) {
    const assumptions = normalizeFinancialAssumptions(input);
    const scenarios = {
        conservative: { assumptions: vary(assumptions, 0.65, 0.9, 1.1) },
        base: { assumptions },
        upside: { assumptions: vary(assumptions, 1.35, 1.08, 1.05) }
    };
    Object.values(scenarios).forEach(scenario => Object.assign(scenario, project(scenario.assumptions, options.months || 36)));
    const warnings = [];
    if (assumptions.monthlyCustomerGrowthPct <= assumptions.monthlyChurnPct) warnings.push('Customer growth does not exceed churn, so the customer base will not compound.');
    if (assumptions.startingCapital < assumptions.oneTimeStartupCosts) warnings.push('Starting capital does not cover the entered startup costs.');
    if (assumptions.monthlyPrice === 0) warnings.push('Monthly price is zero; revenue remains zero until another revenue stream is modeled.');
    if (scenarios.base.runwayMonths !== null) warnings.push(`Base-case cash becomes negative after month ${scenarios.base.runwayMonths}.`);
    return { methodology: 'Deterministic monthly cohort projection; scenarios vary growth, price, and costs from founder-entered assumptions.', currency: options.currency || 'USD', assumptions, scenarios, warnings, calculatedAt: new Date().toISOString() };
}

export function financialModelMarkdown(model) {
    const rows = Object.entries(model.scenarios).map(([name, scenario]) => {
        const years = scenario.annual.map(year => `$${Math.round(year.revenue).toLocaleString()}`).join(' | ');
        return `| ${name} | ${years} | ${scenario.breakEvenMonth || 'Not in 36 months'} | $${Math.round(scenario.endingCash).toLocaleString()} |`;
    });
    return `## Deterministic Financial Model\n\nAll values below are calculated from founder-controlled assumptions; they are not AI estimates or historical results.\n\n| Scenario | Year 1 revenue | Year 2 revenue | Year 3 revenue | Break-even month | Ending cash |\n|---|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n### Base assumptions\n\n${Object.entries(model.assumptions).map(([key, value]) => `- **${key}:** ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}${model.warnings.length ? `\n\n### Model warnings\n\n${model.warnings.map(item => `- ${item}`).join('\n')}` : ''}`;
}

export default buildFinancialModel;
