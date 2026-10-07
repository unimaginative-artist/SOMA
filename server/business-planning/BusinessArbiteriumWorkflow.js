import crypto from 'node:crypto';

export function buildBusinessArbiteriumSteps() {
    return [
        { id:'market-proof', description:'Validate TAM/SAM/SOM inputs and close the highest-impact evidence gaps', assignedArbiterRole:'finance', dependencies:[], status:'pending' },
        { id:'competitor-proof', description:'Produce a sourced competitor, substitute, saturation, and differentiation matrix', assignedArbiterRole:'analyst', dependencies:['market-proof'], status:'pending' },
        { id:'pricing-proof', description:'Run pricing interviews or commitment tests and validate contribution economics', assignedArbiterRole:'strategy', dependencies:['competitor-proof'], status:'pending' },
        { id:'gtm-proof', description:'Test one acquisition channel with a capped budget and measured CAC', assignedArbiterRole:'strategy', dependencies:['pricing-proof'], status:'pending' },
        { id:'risk-gate', description:'Audit regulatory, financing, operational, and evidence risks before scale', assignedArbiterRole:'risk', dependencies:['gtm-proof'], status:'pending' },
        { id:'operator-brief', description:'Compile verified findings, decisions, KPI changes, and the next 90-day operating brief', assignedArbiterRole:'archivist', dependencies:['risk-gate'], status:'pending' }
    ];
}

export function buildBusinessArbiteriumWorkflow(job) {
    const label = job.profile?.businessName || job.profile?.concept || 'Business plan';
    return {
        id: `business-${crypto.randomUUID()}`, sourceJobId: job.id, title: `${label} · execution council`,
        goal: `Turn the approved ${label} business plan into verified operating execution without changing its approved assumptions silently.`,
        summary: 'Evidence, economics, go-to-market, risk, and execution workflow prepared by Muse Business Planning.',
        createdAt: Date.now(), status: 'prepared',
        context: { marketModel: job.marketModel, pricingModel: job.pricingModel, financialModel: job.financialModel, evidence: job.evidence?.ledger || [], operatingWorkspace: job.operatingWorkspace },
        steps: buildBusinessArbiteriumSteps()
    };
}

export default buildBusinessArbiteriumWorkflow;
