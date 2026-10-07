import crypto from 'node:crypto';

const item = (type, title, extra = {}) => ({ id: crypto.randomUUID(), type, title, status: 'open', owner: 'Founder', createdAt: Date.now(), ...extra });

export function createOperatingWorkspace(profile = {}, financialModel = {}) {
    const base = financialModel.scenarios?.base;
    return {
        decisions: [
            item('decision', 'Choose the narrowest launch customer segment', { due: 'Week 2' }),
            item('decision', 'Approve the initial offer, price, and validation threshold', { due: 'Week 3' })
        ],
        assumptions: [
            item('assumption', `The target customer has an urgent enough problem to adopt ${profile.solution || profile.concept}`, { confidence: 'low' }),
            item('assumption', `The initial monthly price of $${financialModel.assumptions?.monthlyPrice ?? 0} is acceptable`, { confidence: 'low' }),
            item('assumption', 'A repeatable acquisition channel can be found before scaling costs', { confidence: 'low' })
        ],
        experiments: [
            item('experiment', 'Complete 15 structured customer interviews', { metric: 'At least 8 describe the problem as urgent', due: 'Day 30' }),
            item('experiment', 'Run a price and offer test with a real commitment', { metric: 'At least 3 qualified commitments', due: 'Day 45' }),
            item('experiment', 'Test one acquisition channel with a capped budget', { metric: 'Measured lead and acquisition cost', due: 'Day 60' })
        ],
        milestones: [
            item('milestone', 'Problem and customer segment validated', { due: 'Quarter 1' }),
            item('milestone', 'Repeatable offer and initial paying customers', { due: 'Quarter 2' }),
            item('milestone', 'Channel economics measured and operating process documented', { due: 'Quarter 3' }),
            item('milestone', 'Scale/no-scale decision based on evidence', { due: 'Quarter 4' })
        ],
        kpis: [
            item('kpi', 'Qualified customer conversations per week', { target: 5 }),
            item('kpi', 'Monthly recurring revenue', { target: base?.annual?.[0]?.revenue || 0 }),
            item('kpi', 'Monthly customer churn percent', { target: financialModel.assumptions?.monthlyChurnPct ?? 0 }),
            item('kpi', 'Ending cash runway', { target: base?.runwayMonths ?? '36+ months' })
        ],
        tasks: [
            item('task', 'Create interview script and prospect list', { due: 'Week 1' }),
            item('task', 'Build evidence-backed competitor matrix', { due: 'Week 2' }),
            item('task', 'Verify licenses, insurance, tax, and banking requirements', { due: 'Week 3' })
        ],
        updatedAt: Date.now()
    };
}

export function updateOperatingItem(workspace, collection, id, patch = {}) {
    if (!['decisions', 'assumptions', 'experiments', 'milestones', 'kpis', 'tasks'].includes(collection)) throw new Error('Unknown operating collection');
    const target = workspace?.[collection]?.find(entry => entry.id === id);
    if (!target) throw new Error('Operating item not found');
    Object.assign(target, Object.fromEntries(Object.entries(patch).filter(([key]) => ['title', 'status', 'owner', 'due', 'metric', 'target', 'confidence', 'notes'].includes(key))));
    workspace.updatedAt = Date.now();
    return target;
}

export default createOperatingWorkspace;
