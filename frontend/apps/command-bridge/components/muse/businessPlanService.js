const FIELD_LABELS = {
  businessName: 'Business name',
  concept: 'Business concept',
  customer: 'Ideal customer',
  problem: 'Customer problem',
  solution: 'Product or service',
  revenueModel: 'Revenue model',
  stage: 'Current stage',
  geography: 'Geography',
  founderAdvantages: 'Founder advantages',
  goals: '12-month goals',
  constraints: 'Constraints',
};

export const EMPTY_BUSINESS_PROFILE = Object.freeze({
  businessName: '', concept: '', customer: '', problem: '', solution: '',
  revenueModel: '', stage: 'idea', geography: '', founderAdvantages: '', goals: '', constraints: '',
  financialAssumptions: { startingCapital:5000, startingCustomers:5, monthlyPrice:100, monthlyCustomerGrowthPct:12, monthlyChurnPct:3, grossMarginPct:70, fixedMonthlyCosts:2500, variableCostPerCustomer:10, customerAcquisitionCost:250, oneTimeStartupCosts:3500, annualHiringCosts:[0,45000,90000], taxRatePct:21 },
});

export function profileCompleteness(profile = {}) {
  const fields = Object.keys(FIELD_LABELS);
  return Math.round((fields.filter((field) => String(profile[field] || '').trim()).length / fields.length) * 100);
}

export function missingRequiredFields(profile = {}) {
  return ['concept', 'customer', 'problem']
    .filter((field) => !String(profile[field] || '').trim())
    .map((field) => FIELD_LABELS[field]);
}

export function buildBusinessPlanPrompt(profile = {}) {
  const brief = Object.entries(FIELD_LABELS)
    .map(([field, label]) => `- ${label}: ${String(profile[field] || 'Not provided').trim() || 'Not provided'}`)
    .join('\n');

  return `You are SOMA acting as a rigorous business strategist. Build a decision-ready business plan from the founder brief below.

FOUNDER BRIEF
${brief}

Return polished Markdown with these exact top-level sections:
# ${String(profile.businessName || 'Business Plan').trim() || 'Business Plan'}
## Executive Summary
## Company and Vision
## Customer Problem
## Product or Service
## Market Opportunity
## Competitive Landscape
## Business Model
## Go-to-Market Strategy
## Operations and Technology
## Team and Hiring
## 12-Month Milestones
## Financial Framework
## Risks and Mitigations
## Funding Ask and Use of Funds
## Assumptions and Evidence Needed

Requirements:
- Make the plan specific, commercially realistic, and concise enough to use.
- Never invent citations, customers, traction, market-size figures, or financial history.
- Label unknowns and estimates clearly. Use ranges and explain the driver behind each estimate.
- Include a simple 3-year scenario table with conservative, base, and upside cases; state every assumption.
- Use a quarter-by-quarter milestone table with measurable outcomes.
- End with the five highest-leverage questions the founder should answer next.
- Start directly with the H1 title.`;
}

export function extractBusinessPlanResponse(payload = {}) {
  return String(payload.response || payload.message || payload.text || payload.answer || '').trim();
}

export function businessPlanFilename(name = 'business-plan') {
  const stem = String(name || 'business-plan').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business-plan';
  return `${stem}-business-plan.md`;
}
