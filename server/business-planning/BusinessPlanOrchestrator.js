import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildFinancialModel, financialModelMarkdown, normalizeFinancialAssumptions } from './BusinessFinancialModel.js';
import BusinessEvidenceService from './BusinessEvidenceService.js';
import { createOperatingWorkspace, updateOperatingItem } from './BusinessOperatingModel.js';
import { buildMarketSizingModel, buildPricingModel, buildSensitivityAnalysis, defaultPricingTiersForFinancial, normalizeMarketAssumptions, normalizePricingTiers } from './BusinessMarketModel.js';
import BusinessPlanExportService from './BusinessPlanExportService.js';
import { buildBusinessArbiteriumWorkflow } from './BusinessArbiteriumWorkflow.js';

const require = createRequire(import.meta.url);
const { KevinResearchService } = require('../utils/KevinResearchService.cjs');

const JOB_VERSION = 2;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_JOB_DIR = path.join(process.cwd(), 'SOMA', 'business-plans', 'jobs');

const STAGE_DEFINITIONS = [
    ['brief', 'Founder brief audit'],
    ['evidence', 'Evidence and market scan'],
    ['specialists', 'Specialist council'],
    ['red_team', 'Adversarial review'],
    ['synthesis', 'Executive synthesis'],
    ['quality_gate', 'Professional quality gate'],
    ['finalize', 'Final revision']
];

const SPECIALISTS = [
    {
        id: 'market', label: 'Market Intelligence', aliases: ['startup-analyst', 'business-analyst'], brain: 'PROMETHEUS',
        task: 'Assess customer segments, alternatives, competitive forces, TAM/SAM/SOM methodology, market-entry wedge, and the evidence still required. Never fabricate market figures.'
    },
    {
        id: 'product', label: 'Product & Customer', aliases: ['product', 'product-guidelines', 'business-analyst'], brain: 'PROMETHEUS',
        task: 'Define the value proposition, jobs-to-be-done, product scope, validation experiments, defensibility, and a realistic product roadmap.'
    },
    {
        id: 'gtm', label: 'Go-to-Market', aliases: ['sales-automator', 'content-marketer', 'business-analyst'], brain: 'PROMETHEUS',
        task: 'Design positioning, pricing tests, acquisition channels, sales motion, funnel metrics, partnerships, and a staged go-to-market plan.'
    },
    {
        id: 'finance', label: 'Financial Modeling', aliases: ['startup-analyst', 'business-analyst'], brain: 'LOGOS',
        task: 'Build an assumption-driven three-year financial framework with conservative/base/upside scenarios, unit economics, cash needs, break-even logic, and funding use. Clearly label every estimate.'
    },
    {
        id: 'operations', label: 'Operations & Risk', aliases: ['business-analyst', 'legal-advisor', 'startup-analyst'], brain: 'THALAMUS',
        task: 'Assess operating model, staffing, technology, dependencies, legal or regulatory issues, execution risks, controls, and measurable twelve-month milestones.'
    }
];

function clip(value, limit = 12000) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

function textOf(value) {
    return String(value?.text || value?.response || value?.message || value?.result || value || '').trim();
}

function jsonObjectOf(value) {
    const text = textOf(value).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('SOMA returned no structured model proposal');
    return JSON.parse(match[0]);
}

function safeProfile(profile = {}) {
    const allowed = ['businessName', 'concept', 'customer', 'problem', 'solution', 'revenueModel', 'stage', 'geography', 'founderAdvantages', 'goals', 'constraints'];
    return {
        ...Object.fromEntries(allowed.map(key => [key, clip(String(profile[key] || '').trim(), 4000)])),
        financialAssumptions: normalizeFinancialAssumptions(profile.financialAssumptions || {}),
        marketAssumptions: normalizeMarketAssumptions(profile.marketAssumptions || {}),
        pricingTiers: Array.isArray(profile.pricingTiers) && profile.pricingTiers.length ? normalizePricingTiers(profile.pricingTiers) : []
    };
}

function profileText(profile) {
    return Object.entries(profile).map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value || 'Not provided'}`).join('\n');
}

function publicJob(job) {
    const collaboration = job.collaboration || { messages: [], revisions: [], versions: [] };
    return {
        id: job.id,
        version: job.version,
        status: job.status,
        progress: job.progress,
        currentStage: job.currentStage,
        currentLabel: job.currentLabel,
        createdAt: job.createdAt,
        startedAt: job.startedAt || null,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt || null,
        elapsedMs: job.startedAt ? (job.completedAt || Date.now()) - job.startedAt : 0,
        stages: job.stages,
        participants: job.participants,
        evidence: job.evidence,
        financialModel: job.financialModel || null,
        marketModel: job.marketModel || null,
        pricingModel: job.pricingModel || null,
        sensitivityAnalysis: job.sensitivityAnalysis || null,
        modelProposal: job.modelProposal || null,
        modelVersions: job.modelVersions || [],
        arbiteriumHandoffs: job.arbiteriumHandoffs || [],
        operatingWorkspace: job.operatingWorkspace || null,
        scenarios: job.scenarios || [],
        resourceUsage: job.resourceUsage || null,
        collaboration: {
            messages: collaboration.messages || [],
            revisions: (collaboration.revisions || []).map(publicRevision),
            versions: (collaboration.versions || []).map(({ plan: _plan, ...version }) => version)
        },
        plan: job.plan || '',
        currentVersion: (collaboration.versions || []).length + 1,
        error: job.error || null
    };
}

function publicRevision(revision) {
    if (!revision) return null;
    return {
        id: revision.id, kind: revision.kind || 'revision', status: revision.status, progress: revision.progress,
        currentLabel: revision.currentLabel, request: revision.request,
        createdAt: revision.createdAt, updatedAt: revision.updatedAt,
        completedAt: revision.completedAt || null,
        selectedSpecialists: revision.selectedSpecialists || [],
        changedSections: revision.changedSections || [], summary: revision.summary || '',
        revisedPlan: revision.revisedPlan || '', answer: revision.answer || '', error: revision.error || null
    };
}

export class BusinessPlanOrchestrator {
    constructor(system = {}, options = {}) {
        this.system = system;
        this.jobs = new Map();
        this.jobDir = options.jobDir || DEFAULT_JOB_DIR;
        this.research = options.researchService || new KevinResearchService();
        this.now = options.now || (() => Date.now());
        this.evidenceService = options.evidenceService || new BusinessEvidenceService(system, { researchService: this.research, now: this.now });
        this.controllers = new Map();
        this.resumeScheduled = new Set();
        this.maxConcurrentPerOwner = Number(options.maxConcurrentPerOwner || process.env.SOMA_BUSINESS_PLAN_MAX_CONCURRENT || 2);
        this.maxBrainCalls = Number(options.maxBrainCalls || process.env.SOMA_BUSINESS_PLAN_MAX_BRAIN_CALLS || 24);
        this.exportService = options.exportService || new BusinessPlanExportService({ baseDir: options.exportDir });
    }

    _brain() {
        return this.system.quadBrain || this.system.somArbiter || this.system.kevinArbiter || this.system.brain || this.system.superintelligence;
    }

    _assertAvailable() {
        if (!this._brain()?.reason) throw new Error('SOMA reasoning engine is not available yet');
    }

    _newJob(profile, context) {
        const now = this.now();
        const financialModel = buildFinancialModel(profile.financialAssumptions);
        const pricingTiers = profile.pricingTiers?.length ? normalizePricingTiers(profile.pricingTiers) : defaultPricingTiersForFinancial(financialModel.assumptions);
        const pricingModel = buildPricingModel(pricingTiers, financialModel.assumptions);
        const marketAssumptions = normalizeMarketAssumptions(profile.marketAssumptions || {});
        const marketModel = buildMarketSizingModel(marketAssumptions, {}, financialModel);
        return {
            id: crypto.randomUUID(), version: JOB_VERSION, status: 'queued', progress: 0,
            currentStage: 'queued', currentLabel: 'Preparing the council', createdAt: now,
            updatedAt: now, profile, context, stages: STAGE_DEFINITIONS.map(([id, label]) => ({ id, label, status: 'pending' })),
            ownerId: context.ownerId || 'local-owner', participants: [], evidence: { status: 'pending', sources: [], notes: [] }, artifacts: {}, plan: '',
            financialModel, marketAssumptions, marketModel, pricingTiers, pricingModel,
            sensitivityAnalysis: buildSensitivityAnalysis(financialModel.assumptions, marketAssumptions, pricingTiers),
            modelProposal: null, modelVersions: [], operatingWorkspace: null, scenarios: [], arbiteriumHandoffs: [],
            resourceUsage: { brainCalls: 0, webQueries: 0, maxBrainCalls: this.maxBrainCalls, startedAt: null },
            collaboration: { messages: [], revisions: [], versions: [] }, expiresAt: now + (180 * 24 * 60 * 60 * 1000)
        };
    }

    async create(profile = {}, context = {}) {
        this._assertAvailable();
        const clean = safeProfile(profile);
        const missing = ['concept', 'customer', 'problem'].filter(key => !clean[key]);
        if (missing.length) throw new Error(`Missing required business brief fields: ${missing.join(', ')}`);
        const ownerId = String(context.ownerId || 'local-owner');
        const activeCount = [...this.jobs.values()].filter(item => item.ownerId === ownerId && !TERMINAL.has(item.status)).length;
        if (activeCount >= this.maxConcurrentPerOwner) throw new Error(`Only ${this.maxConcurrentPerOwner} business-plan builds can run at once`);
        const job = this._newJob(clean, { sessionId: String(context.sessionId || ''), source: 'muse-business-planning', ownerId });
        this.jobs.set(job.id, job);
        await this._persist(job);
        setImmediate(() => this.run(job.id).catch(() => {}));
        return publicJob(job);
    }

    async get(id, ownerId = 'local-owner') {
        if (this.jobs.has(id)) { this._assertOwner(this.jobs.get(id), ownerId); return publicJob(this.jobs.get(id)); }
        try {
            const stored = JSON.parse(await fs.readFile(this._jobPath(id), 'utf8'));
            if (stored?.id === id) {
                stored.ownerId ||= ownerId;
                this._assertOwner(stored, ownerId);
                this._ensureCollaboration(stored);
                this.jobs.set(id, stored);
                if (stored.status === 'running' || stored.status === 'queued') this._scheduleResume(stored);
                for (const revision of stored.collaboration.revisions) if (revision.status === 'running' || revision.status === 'queued') this._scheduleRevisionResume(stored, revision);
                return publicJob(stored);
            }
        } catch {}
        return null;
    }

    async cancel(id, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (!job || TERMINAL.has(job.status)) return job ? publicJob(job) : null;
        job.cancelRequested = true;
        this.controllers.get(id)?.abort();
        job.updatedAt = this.now();
        await this._persist(job);
        return publicJob(job);
    }

    async createRevision(id, request, mode = 'auto', ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (!job) throw new Error('Business plan job not found');
        if (job.status !== 'completed') throw new Error('The initial business plan must finish before collaboration begins');
        const message = clip(String(request || '').trim(), 5000);
        if (!message) throw new Error('Tell SOMA what you want to change');
        this._ensureCollaboration(job);
        const active = job.collaboration.revisions.find(item => item.status === 'queued' || item.status === 'running' || item.status === 'proposed');
        if (active) throw new Error(active.status === 'proposed' ? 'Review the current proposal before starting another revision' : 'SOMA is already preparing a revision');
        const selected = this._selectRevisionSpecialists(message);
        const kind = mode === 'exploration' || mode === 'revision' ? mode : this._classifyCollaborationIntent(message);
        const now = this.now();
        const revision = {
            id: crypto.randomUUID(), kind, status: 'queued', progress: 0, currentLabel: kind === 'exploration' ? 'Exploring the scenario' : 'Routing your request',
            request: message, createdAt: now, updatedAt: now,
            selectedSpecialists: selected.map(item => item.label), changedSections: this._inferChangedSections(message, selected),
            memos: {}, revisedPlan: '', answer: '', summary: ''
        };
        job.collaboration.revisions.push(revision);
        job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'user', content: message, createdAt: now, revisionId: revision.id });
        job.updatedAt = now;
        await this._persist(job);
        setImmediate(() => this.runRevision(id, revision.id).catch(() => {}));
        return { job: publicJob(job), revision: publicRevision(revision) };
    }

    async getRevision(id, revisionId, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        const revision = job?.collaboration?.revisions?.find(item => item.id === revisionId);
        return revision ? { job: publicJob(job), revision: publicRevision(revision) } : null;
    }

    async runRevision(id, revisionId) {
        const job = this.jobs.get(id);
        const revision = job?.collaboration?.revisions?.find(item => item.id === revisionId);
        if (!job || !revision || revision.status !== 'queued') return null;
        revision.status = 'running'; revision.progress = 8; revision.currentLabel = 'Consulting the right specialists'; revision.updatedAt = this.now();
        await this._persist(job);
        try {
            const selected = this._selectRevisionSpecialists(revision.request);
            const recentConversation = job.collaboration.messages.slice(-10).map(message => `${message.role}: ${message.content}`).join('\n');
            const settled = await Promise.allSettled(selected.map(async specialist => {
                const persona = this._persona(specialist.aliases);
                const memo = await this._reason(`You are collaborating with a founder on an existing business plan. Analyze only the requested change from your specialty. Identify implications elsewhere in the plan, numbers that must remain consistent, assumptions to expose, and an exact revision recommendation.\n\nFOUNDER REQUEST\n${revision.request}\n\nRECENT COLLABORATION\n${clip(recentConversation, 7000)}\n\nCURRENT PLAN\n${clip(job.plan, 36000)}`, { persona, preferredBrain: specialist.brain, job });
                return [specialist.id, memo];
            }));
            settled.forEach((result, index) => {
                const specialist = selected[index];
                revision.memos[specialist.id] = result.status === 'fulfilled' ? result.value[1] : `Unavailable: ${result.reason?.message || 'specialist failed'}`;
            });
            if (revision.kind === 'exploration') {
                revision.progress = 62; revision.currentLabel = 'Building the scenario'; revision.updatedAt = this.now();
                await this._persist(job);
                const memoText = Object.entries(revision.memos).map(([name, memo]) => `## ${name}\n${clip(memo, 8000)}`).join('\n\n');
                const scenarioPrompt = `You are SOMA collaborating with a founder inside an existing business plan. Answer the hypothetical or brainstorming question directly without modifying the plan. Make the scenario concrete and decision-useful. For financial hypotheticals, show assumptions, a simple allocation or projection table, constraints, tradeoffs, and what would have to be true. Distinguish exploration from commitment and finish by asking the most useful next question.\n\nFOUNDER QUESTION\n${revision.request}\n\nSPECIALIST PERSPECTIVES\n${memoText}\n\nCURRENT PLAN CONTEXT\n${clip(job.plan, 36000)}`;
                const crona = this.system.crona || this.system.cronaArbiter;
                if (crona?.reason) {
                    const result = await crona.reason(scenarioPrompt, { conversationHistory: [], systemPrompt: 'Explore business scenarios rigorously without changing the approved plan.', domain: 'business_planning_exploration' });
                    revision.answer = result?.ok !== false ? textOf(result) : '';
                }
                if (!revision.answer) revision.answer = await this._reason(scenarioPrompt, { preferredBrain: 'PROMETHEUS', deepThinking: true, job });
                revision.status = 'answered'; revision.progress = 100; revision.currentLabel = 'Scenario explored';
                revision.completedAt = this.now(); revision.updatedAt = this.now();
                job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', revisionId: revision.id, createdAt: this.now(), content: revision.answer });
                job.updatedAt = this.now();
                await this._persist(job);
                return { job: publicJob(job), revision: publicRevision(revision) };
            }
            revision.progress = 48; revision.currentLabel = 'Drafting a targeted revision'; revision.updatedAt = this.now();
            await this._persist(job);

            const memoText = Object.entries(revision.memos).map(([name, memo]) => `## ${name}\n${clip(memo, 8000)}`).join('\n\n');
            const draft = await this._reason(`Revise the existing business plan in direct response to the founder request. Change only what is necessary, but propagate dependencies so financials, milestones, risks, positioning, and operations remain internally consistent. Preserve the complete document and all unaffected detail. Never invent evidence. Return only the full revised Markdown plan beginning with its H1 title.\n\nFOUNDER REQUEST\n${revision.request}\n\nSPECIALIST MEMOS\n${memoText}\n\nCURRENT PLAN\n${clip(job.plan, 44000)}`, { preferredBrain: 'PROMETHEUS', deepThinking: true, job });
            revision.progress = 70; revision.currentLabel = 'Checking downstream consequences'; revision.updatedAt = this.now();
            await this._persist(job);

            const advocate = this.system.devilsAdvocate || this.system.crona?.devilsAdvocate;
            const critique = advocate?.challenge
                ? await advocate.challenge(revision.request, draft)
                : await this._reason(`Quality-check this proposed plan revision. Find accidental changes, contradictions, unsupported claims, broken calculations, and failure to satisfy the founder request. Return a concise correction memo.\n\nREQUEST\n${revision.request}\n\nPROPOSED PLAN\n${clip(draft, 40000)}`, { preferredBrain: 'THALAMUS', job });
            revision.progress = 86; revision.currentLabel = 'Preparing the proposal'; revision.updatedAt = this.now();
            await this._persist(job);

            revision.revisedPlan = await this._reason(`Produce the final proposed revision of this business plan. Apply the review only where it improves correctness and alignment with the founder request. Preserve the full plan, label assumptions, and return only Markdown beginning with the H1 title.\n\nFOUNDER REQUEST\n${revision.request}\n\nREVISION DRAFT\n${clip(draft, 44000)}\n\nADVERSARIAL REVIEW\n${clip(critique, 10000)}`, { preferredBrain: 'PROMETHEUS', deepThinking: true, job });
            revision.summary = `Proposed changes for: ${revision.request}`;
            revision.status = 'proposed'; revision.progress = 100; revision.currentLabel = 'Ready for your review';
            revision.completedAt = this.now(); revision.updatedAt = this.now();
            job.collaboration.messages.push({
                id: crypto.randomUUID(), role: 'assistant', revisionId: revision.id, createdAt: this.now(),
                content: `I prepared a revision with ${revision.selectedSpecialists.join(', ')}. Review the proposal, then apply it or keep the current plan.`
            });
            job.updatedAt = this.now();
            await this._persist(job);
            return { job: publicJob(job), revision: publicRevision(revision) };
        } catch (error) {
            revision.status = 'failed'; revision.error = error.message; revision.currentLabel = 'Revision failed';
            revision.completedAt = this.now(); revision.updatedAt = this.now();
            job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', revisionId: revision.id, createdAt: this.now(), content: `I could not complete that revision: ${error.message}` });
            await this._persist(job);
            return { job: publicJob(job), revision: publicRevision(revision) };
        }
    }

    async applyRevision(id, revisionId, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        const revision = job?.collaboration?.revisions?.find(item => item.id === revisionId);
        if (!revision) throw new Error('Revision not found');
        if (revision.status !== 'proposed' || !revision.revisedPlan) throw new Error('Revision is not ready to apply');
        this._ensureCollaboration(job);
        const versionNumber = job.collaboration.versions.length + 1;
        job.collaboration.versions.push({ id: crypto.randomUUID(), version: versionNumber, plan: job.plan, createdAt: this.now(), reason: revision.request, revisionId });
        job.plan = revision.revisedPlan;
        revision.status = 'applied'; revision.updatedAt = this.now();
        job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', revisionId, createdAt: this.now(), content: `Applied the revision. The previous plan is preserved as version ${versionNumber}.` });
        job.updatedAt = this.now();
        await this._persist(job);
        return { job: publicJob(job), revision: publicRevision(revision) };
    }

    async discardRevision(id, revisionId, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        const revision = job?.collaboration?.revisions?.find(item => item.id === revisionId);
        if (!revision) throw new Error('Revision not found');
        if (revision.status !== 'proposed') throw new Error('Only a proposed revision can be discarded');
        revision.status = 'discarded'; revision.updatedAt = this.now();
        job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', revisionId, createdAt: this.now(), content: 'Kept the current plan unchanged. Tell me what you would like to try instead.' });
        job.updatedAt = this.now();
        await this._persist(job);
        return { job: publicJob(job), revision: publicRevision(revision) };
    }

    async run(id) {
        const job = this.jobs.get(id);
        if (!job || !['queued', 'running'].includes(job.status)) return job ? publicJob(job) : null;
        if (this.controllers.has(id)) return publicJob(job);
        const controller = new AbortController();
        this.controllers.set(id, controller);
        job.status = 'running';
        job.startedAt ||= this.now();
        job.resourceUsage ||= { brainCalls: 0, webQueries: 0, maxBrainCalls: this.maxBrainCalls, startedAt: job.startedAt };
        job.resourceUsage.startedAt ||= job.startedAt;
        await this._persist(job);

        try {
            await this._stage(job, 'brief', 8, async () => {
                const persona = this._persona(['startup-analyst', 'business-analyst']);
                this._participant(job, persona?.name || 'Startup Analyst', 'lead strategist');
                return this._reason(`Act as the lead startup strategist. Audit this founder brief before other specialists begin. Identify contradictions, missing decisions, the core strategic thesis, and 8-12 explicit assumptions. Do not write the final plan yet.\n\nFOUNDER BRIEF\n${profileText(job.profile)}`, { persona, preferredBrain: 'PROMETHEUS', job, signal: controller.signal });
            });

            await this._stage(job, 'evidence', 18, () => this._collectEvidence(job));

            await this._stage(job, 'specialists', 58, async () => {
                const settled = await Promise.allSettled(SPECIALISTS.map(async specialist => {
                    const persona = this._persona(specialist.aliases);
                    this._participant(job, persona?.name || specialist.label, specialist.label);
                    const result = await this._reason(`${specialist.task}\n\nUse the founder brief, lead audit, deterministic financial model, and evidence packet below. Cite live evidence only with its stable source ID, such as [S1]. Distinguish facts, estimates, assumptions, and open research questions. Return a concise decision memo for the final plan writer.\n\nFOUNDER BRIEF\n${profileText(job.profile)}\n\nFINANCIAL MODEL\n${financialModelMarkdown(job.financialModel)}\n\nLEAD AUDIT\n${clip(job.artifacts.brief)}\n\nEVIDENCE PACKET\n${clip(job.artifacts.evidence)}`, { persona, preferredBrain: specialist.brain, job, signal: controller.signal });
                    return [specialist.id, result];
                }));
                const memos = {};
                settled.forEach((result, index) => {
                    const specialist = SPECIALISTS[index];
                    memos[specialist.id] = result.status === 'fulfilled' ? result.value[1] : `Specialist unavailable: ${result.reason?.message || 'unknown failure'}`;
                });
                if (!Object.values(memos).some(value => !String(value).startsWith('Specialist unavailable:'))) throw new Error('Every specialist failed to return a memo');
                return memos;
            });

            await this._stage(job, 'red_team', 70, async () => {
                const councilDraft = Object.entries(job.artifacts.specialists).map(([key, value]) => `## ${key}\n${clip(value, 9000)}`).join('\n\n');
                const advocate = this.system.devilsAdvocate || this.system.crona?.devilsAdvocate;
                this._participant(job, advocate?.name || 'Devil’s Advocate', 'adversarial reviewer');
                if (advocate?.challenge) {
                    return advocate.challenge(`Test the business plan for ${job.profile.businessName || job.profile.concept}`, councilDraft);
                }
                return this._reason(`You are a skeptical investment committee and red-team reviewer. Attack the council memos below. Find unsupported claims, fatal assumptions, weak economics, channel risks, regulatory issues, founder blind spots, and concrete falsification tests.\n\n${clip(councilDraft, 30000)}`, { preferredBrain: 'THALAMUS', job, signal: controller.signal });
            });

            await this._stage(job, 'synthesis', 84, async () => {
                this._participant(job, 'CRONA', 'causal synthesis');
                const prompt = this._synthesisPrompt(job);
                const crona = this.system.crona || this.system.cronaArbiter;
                if (crona?.reason) {
                    const result = await crona.reason(prompt, { conversationHistory: [], systemPrompt: 'You are SOMA conducting an executive-grade business planning synthesis.', domain: 'business_planning' });
                    if (result?.ok !== false && textOf(result)) return textOf(result);
                }
                return this._reason(prompt, { preferredBrain: 'PROMETHEUS', deepThinking: true, job, signal: controller.signal });
            });

            await this._stage(job, 'quality_gate', 93, async () => {
                this._participant(job, 'Investment Committee', 'quality gate');
                return this._reason(`Audit the proposed business plan against professional investor and operator standards. Check internal consistency, arithmetic logic, scenario assumptions, actionability, evidence labeling, competitive realism, risk coverage, and whether every requested section exists. Return a prioritized revision memo; do not rewrite the plan.\n\nPLAN\n${clip(job.artifacts.synthesis, 38000)}\n\nRED TEAM\n${clip(job.artifacts.red_team, 8000)}`, { preferredBrain: 'LOGOS', job, signal: controller.signal });
            });

            await this._stage(job, 'finalize', 99, async () => {
                const result = await this._reason(`You are the managing partner responsible for the final business plan. Revise the draft using the quality-gate memo. Preserve useful specificity, correct inconsistencies, label all unknowns and estimates, and never invent evidence. Use only [S#] citations present in the evidence ledger. Return only polished Markdown beginning with the H1 title.\n\nDRAFT\n${clip(job.artifacts.synthesis, 42000)}\n\nQUALITY-GATE MEMO\n${clip(job.artifacts.quality_gate, 10000)}\n\nDETERMINISTIC MODEL (must remain numerically consistent)\n${financialModelMarkdown(job.financialModel)}\n\nRequired top-level sections: Executive Summary; Company and Vision; Customer Problem; Product or Service; Market Opportunity; Competitive Landscape; Business Model; Go-to-Market Strategy; Operations and Technology; Team and Hiring; 12-Month Milestones; Financial Framework; Risks and Mitigations; Funding Ask and Use of Funds; Assumptions and Evidence Needed; Sources. Include three-year scenario and quarterly milestone tables, followed by the five highest-leverage founder questions.`, { preferredBrain: 'PROMETHEUS', deepThinking: true, job, signal: controller.signal });
                return result || job.artifacts.synthesis;
            });

            job.plan = textOf(job.artifacts.finalize || job.artifacts.synthesis);
            if (!job.plan) throw new Error('The council completed without producing a plan');
            job.progress = 100;
            job.currentStage = 'completed';
            job.currentLabel = 'Plan complete';
            job.completedAt = this.now();
            job.updatedAt = this.now();
            this._ensureCollaboration(job);
            job.operatingWorkspace ||= createOperatingWorkspace(job.profile, job.financialModel);
            if (!job.collaboration.messages.length) {
                job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', createdAt: this.now(), content: 'The first plan is ready. We can now build the business together—ask me to challenge assumptions, change a section, rerun the numbers, or consult a specialist.' });
            }
            await this._persist({ ...job, status: 'completed' });
            job.status = 'completed';
            return publicJob(job);
        } catch (error) {
            job.status = job.cancelRequested || controller.signal.aborted ? 'cancelled' : 'failed';
            job.error = job.cancelRequested ? 'Plan build cancelled.' : error.message;
            job.currentLabel = job.cancelRequested ? 'Cancelled' : 'Build failed';
            job.completedAt = this.now();
            job.updatedAt = this.now();
            const active = job.stages.find(stage => stage.status === 'running');
            if (active) { active.status = 'failed'; active.error = job.error; active.finishedAt = this.now(); }
            await this._persist(job);
            return publicJob(job);
        } finally {
            this.controllers.delete(id);
            this.resumeScheduled.delete(id);
        }
    }

    async _stage(job, id, progress, work) {
        if (job.cancelRequested) throw new Error('cancelled');
        const stage = job.stages.find(item => item.id === id);
        if (stage?.status === 'completed' && Object.hasOwn(job.artifacts, id)) return job.artifacts[id];
        if (!stage) throw new Error(`Unknown planning stage: ${id}`);
        stage.status = 'running'; stage.startedAt = this.now();
        job.currentStage = id; job.currentLabel = stage.label; job.progress = Math.max(job.progress, progress - 7); job.updatedAt = this.now();
        await this._persist(job);
        const result = await work();
        job.artifacts[id] = result;
        stage.status = 'completed'; stage.finishedAt = this.now(); stage.durationMs = stage.finishedAt - stage.startedAt;
        job.progress = progress; job.updatedAt = this.now();
        await this._persist(job);
        return result;
    }

    _persona(aliases) {
        const personas = this.system.identityArbiter?.personas;
        if (!personas?.size) return null;
        for (const alias of aliases) {
            if (personas.has(alias)) return { name: alias, ...personas.get(alias) };
            const match = [...personas.entries()].find(([name]) => name.toLowerCase() === alias.toLowerCase());
            if (match) return { name: match[0], ...match[1] };
        }
        return null;
    }

    _participant(job, name, role) {
        if (!job.participants.some(item => item.name === name && item.role === role)) job.participants.push({ name, role });
    }

    _ensureCollaboration(job) {
        job.collaboration ||= { messages: [], revisions: [], versions: [] };
        job.collaboration.messages ||= [];
        job.collaboration.revisions ||= [];
        job.collaboration.versions ||= [];
        return job.collaboration;
    }

    _selectRevisionSpecialists(message) {
        const text = String(message).toLowerCase();
        const selected = SPECIALISTS.filter(specialist => {
            if (specialist.id === 'market') return /market|compet|customer|segment|tam|sam|som|research|industry/.test(text);
            if (specialist.id === 'product') return /product|service|feature|solution|value proposition|roadmap|mvp/.test(text);
            if (specialist.id === 'gtm') return /marketing|sales|price|pricing|channel|launch|brand|position|acquisition|gtm/.test(text);
            if (specialist.id === 'finance') return /finance|financial|revenue|cost|budget|cash|capital|fund|margin|scenario|forecast|projection|year|price|pricing/.test(text);
            if (specialist.id === 'operations') return /operation|team|hire|legal|risk|compliance|technology|milestone|timeline|regulat/.test(text);
            return false;
        });
        if (/whole|entire|everything|business model|major|pivot|rebuild/.test(text)) return SPECIALISTS;
        const lead = SPECIALISTS.find(item => item.id === 'product');
        return [...new Map([lead, ...selected].map(item => [item.id, item])).values()].slice(0, 4);
    }

    _classifyCollaborationIntent(message) {
        const text = String(message || '').trim().toLowerCase();
        if (/^(what if|what would|how would|could we|should we|brainstorm|explore|imagine|suppose|compare)\b/.test(text)) return 'exploration';
        const explicitRevision = /^(change|update|revise|rewrite|replace|remove|add|apply|make|lower|raise|reduce|increase|edit|put)\b/.test(text)
            || /^(please\s+|can you\s+|i want to\s+|let'?s\s+)(change|update|revise|rewrite|replace|remove|add|apply|make|lower|raise|reduce|increase|edit)\b/.test(text)
            || /\b(change|update|revise|rewrite|edit)\s+(the|our|this)\s+(plan|section|budget|pricing|strategy|model|numbers?)\b/.test(text);
        if (explicitRevision) return 'revision';
        const exploration = /\b(what if|what would|how would|could we|should we|brainstorm|explore|imagine|suppose|scenario|idea|options?|compare|look like|starting capital)\b/.test(text)
            || text.endsWith('?');
        return exploration ? 'exploration' : 'exploration';
    }

    _inferChangedSections(message, selected) {
        const map = {
            market: ['Market Opportunity', 'Competitive Landscape'],
            product: ['Customer Problem', 'Product or Service'],
            gtm: ['Business Model', 'Go-to-Market Strategy'],
            finance: ['Financial Framework', 'Funding Ask and Use of Funds'],
            operations: ['Operations and Technology', 'Team and Hiring', '12-Month Milestones', 'Risks and Mitigations']
        };
        const sections = selected.flatMap(item => map[item.id] || []);
        if (/executive|summary/.test(String(message).toLowerCase())) sections.unshift('Executive Summary');
        return [...new Set(sections)];
    }

    async _reason(prompt, options = {}) {
        const brain = this._brain();
        if (options.signal?.aborted || options.job?.cancelRequested) throw new Error('cancelled');
        if (options.job) {
            options.job.resourceUsage ||= { brainCalls: 0, maxBrainCalls: this.maxBrainCalls };
            if (options.job.resourceUsage.brainCalls >= (options.job.resourceUsage.maxBrainCalls || this.maxBrainCalls)) throw new Error('Business-planning reasoning budget exhausted');
            options.job.resourceUsage.brainCalls += 1;
        }
        const personaBlock = options.persona?.content ? `SPECIALIST PERSONA\n${clip(options.persona.content, 10000)}\n\n` : '';
        const result = await brain.reason(`${personaBlock}${prompt}`, {
            temperature: options.temperature ?? 0.35,
            preferredBrain: options.preferredBrain || options.persona?.preferredBrain || options.persona?.lobe || 'auto',
            deepThinking: options.deepThinking === true,
            quickResponse: false,
            signal: options.signal,
            source: 'business_plan_orchestrator'
        });
        const text = textOf(result);
        if (!text) throw new Error('A specialist returned an empty analysis');
        return text;
    }

    async _collectEvidence(job) {
        const evidence = await this.evidenceService.research(job.profile, { onQuery: () => { job.resourceUsage.webQueries += 1; }, signal: this.controllers.get(job.id)?.signal });
        const notes = evidence.notes;
        const internal = this.system.hybridSearchArbiter || this.system.hybridSearch;
        if (internal?.search) {
            try {
                const recalled = await Promise.race([internal.search(`${job.profile.concept} ${job.profile.customer} ${job.profile.problem}`, null, { topK: 8 }), new Promise((_, reject) => setTimeout(() => reject(new Error('internal research timeout')), 8000))]);
                notes.push(`SOMA knowledge search completed: ${clip(recalled, 6000)}`);
            } catch (error) { notes.push(`SOMA knowledge search unavailable: ${error.message}`); }
        }
        job.evidence = { ...evidence, notes };
        job.marketModel = buildMarketSizingModel(job.marketAssumptions, job.evidence, job.financialModel);
        job.sensitivityAnalysis = buildSensitivityAnalysis(job.financialModel.assumptions, job.marketAssumptions, job.pricingTiers);
        return job.evidence;
    }

    _synthesisPrompt(job) {
        const memos = Object.entries(job.artifacts.specialists || {}).map(([name, memo]) => `## ${name.toUpperCase()} MEMO\n${clip(memo, 9000)}`).join('\n\n');
        return `Build an executive-grade, decision-ready business plan from a multi-specialist council. Reconcile disagreements instead of averaging them. Treat source excerpts as leads, not automatically verified facts. Never invent citations, customers, traction, market figures, or financial history. Cite only the provided evidence IDs in [S#] form and label facts, estimates, assumptions, and evidence gaps. The deterministic models are the numeric source of truth.\n\nFOUNDER BRIEF\n${profileText(job.profile)}\n\nMARKET SIZING MODEL\n${clip(job.marketModel, 10000)}\n\nPRICING AND UNIT ECONOMICS\n${clip(job.pricingModel, 12000)}\n\nDETERMINISTIC FINANCIAL MODEL\n${financialModelMarkdown(job.financialModel)}\n\nLEAD AUDIT\n${clip(job.artifacts.brief)}\n\nEVIDENCE\n${clip(job.artifacts.evidence, 24000)}\n\nSPECIALIST MEMOS\n${memos}\n\nADVERSARIAL REVIEW\n${clip(job.artifacts.red_team, 10000)}\n\nReturn polished Markdown beginning with # ${job.profile.businessName || 'Business Plan'}. Include the complete professional plan, explicit TAM/SAM/SOM methodology and confidence basis, pricing/unit economics, the exact conservative/base/upside three-year scenario table, quarterly measurable milestones, explicit assumptions and evidence gaps, a Sources section mapping every used [S#] to its URL, and five highest-leverage founder questions.`;
    }

    async listVersions(id, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        this._ensureCollaboration(job);
        return {
            currentVersion: job.collaboration.versions.length + 1,
            versions: job.collaboration.versions.map(({ plan, ...metadata }) => ({ ...metadata, characters: plan?.length || 0 })),
            current: { version: job.collaboration.versions.length + 1, createdAt: job.updatedAt, reason: 'Current plan', characters: job.plan?.length || 0 }
        };
    }

    async recalculateBusinessModel(id, input = {}, ownerId = 'local-owner', reason = 'Founder model update') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (!job) throw new Error('Business plan job not found');
        job.modelVersions ||= [];
        job.modelVersions.push({ id: crypto.randomUUID(), createdAt: this.now(), reason, financialAssumptions: job.financialModel?.assumptions, marketAssumptions: job.marketAssumptions, pricingTiers: job.pricingTiers });
        job.modelVersions = job.modelVersions.slice(-30);

        const calculated = this._calculateBusinessModel(job, input);
        job.financialModel = calculated.financialModel; job.pricingTiers = calculated.pricingTiers; job.pricingModel = calculated.pricingModel;
        job.marketAssumptions = calculated.marketAssumptions; job.marketModel = calculated.marketModel;
        job.sensitivityAnalysis = calculated.sensitivityAnalysis;
        job.modelProposal = null; job.updatedAt = this.now();
        await this._persist(job);
        return publicJob(job);
    }

    _calculateBusinessModel(job, input = {}) {
        const pricingTiers = normalizePricingTiers(input.pricingTiers || job.pricingTiers || []);
        const provisionalPricing = buildPricingModel(pricingTiers, { ...job.financialModel?.assumptions, ...(input.financialAssumptions || {}) });
        const financialInput = { ...job.financialModel?.assumptions, ...(input.financialAssumptions || {}) };
        if (input.usePricingMix === true) {
            financialInput.monthlyPrice = provisionalPricing.weightedAveragePrice;
            financialInput.variableCostPerCustomer = provisionalPricing.weightedAverageDirectCosts;
            financialInput.grossMarginPct = provisionalPricing.weightedGrossMarginPct;
        }
        const financialModel = buildFinancialModel(financialInput);
        const pricingModel = buildPricingModel(pricingTiers, financialModel.assumptions);
        const marketAssumptions = normalizeMarketAssumptions({ ...job.marketAssumptions, ...(input.marketAssumptions || {}) });
        const marketModel = buildMarketSizingModel(marketAssumptions, job.evidence, financialModel);
        return { financialModel, pricingTiers, pricingModel, marketAssumptions, marketModel, sensitivityAnalysis:buildSensitivityAnalysis(financialModel.assumptions, marketAssumptions, pricingTiers) };
    }

    async previewBusinessModel(id, input = {}, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        return this._calculateBusinessModel(job, input);
    }

    async proposeBusinessModelRecalibration(id, request = '', ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (job.status !== 'completed') throw new Error('The initial business plan must finish before recalibration');
        if (!job.evidence?.sources?.length) throw new Error('Live evidence is required before SOMA can auto-populate market assumptions');
        const sourceIds = new Set(job.evidence.sources.map(source => source.id));
        const prompt = `You are SOMA's business-model calibration council. Propose evidence-grounded market inputs and pricing tiers for the existing plan. Use the excerpts only as research leads. Never invent a market figure, customer count, price, cost, CAGR, or confidence. If evidence does not support a numeric input, preserve the current value and list it in unresolved. Every changed market input must cite one or more supplied [S#] IDs. Return ONLY JSON with this schema: {"summary":"...","marketAssumptions":{"totalPotentialCustomers":0,"annualSpendPerCustomer":0,"serviceableGeographyPct":0,"targetSegmentPct":0,"year3ObtainableSharePct":0,"annualMarketGrowthPct":0,"sourceRefs":{"totalPotentialCustomers":["S1"],"annualSpendPerCustomer":["S2"],"annualMarketGrowthPct":["S3"]}},"pricingTiers":[{"id":"core","name":"Core","price":0,"materialCost":0,"laborCost":0,"fulfillmentCost":0,"commissionPct":0,"warrantyReservePct":0,"monthlyVolume":0}],"unresolved":["..."]}.\n\nFOUNDER REQUEST\n${clip(request || 'Recalibrate the model using the strongest available evidence.', 3000)}\n\nCURRENT MARKET INPUTS\n${clip(job.marketAssumptions, 6000)}\n\nCURRENT PRICING\n${clip(job.pricingTiers, 9000)}\n\nEVIDENCE\n${clip(job.evidence, 26000)}`;
        const parsed = jsonObjectOf(await this._reason(prompt, { preferredBrain: 'LOGOS', deepThinking: true, job }));
        const proposedMarket = normalizeMarketAssumptions({ ...job.marketAssumptions, ...(parsed.marketAssumptions || {}) });
        for (const refs of Object.values(proposedMarket.sourceRefs)) for (const id of refs) if (!sourceIds.has(id)) throw new Error(`Model proposal cited unavailable source ${id}`);
        const now = this.now();
        job.modelProposal = {
            id: crypto.randomUUID(), status: 'proposed', summary: clip(parsed.summary || 'Evidence-backed model recalibration', 1200),
            marketAssumptions: proposedMarket, pricingTiers: normalizePricingTiers(parsed.pricingTiers || job.pricingTiers),
            unresolved: (Array.isArray(parsed.unresolved) ? parsed.unresolved : []).map(item => clip(item, 500)).slice(0, 20),
            createdAt: now, updatedAt: now
        };
        job.updatedAt = now; await this._persist(job);
        return { job: publicJob(job), proposal: job.modelProposal };
    }

    async applyBusinessModelProposal(id, proposalId, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (!job.modelProposal || job.modelProposal.id !== proposalId || job.modelProposal.status !== 'proposed') throw new Error('Model proposal not found or no longer active');
        const proposal = job.modelProposal;
        const result = await this.recalculateBusinessModel(id, { marketAssumptions: proposal.marketAssumptions, pricingTiers: proposal.pricingTiers }, ownerId, proposal.summary);
        return result;
    }

    async discardBusinessModelProposal(id, proposalId, ownerId = 'local-owner') {
        await this.get(id, ownerId); const job = this.jobs.get(id);
        if (!job.modelProposal || job.modelProposal.id !== proposalId) throw new Error('Model proposal not found');
        job.modelProposal = { ...job.modelProposal, status: 'discarded', updatedAt: this.now() }; job.updatedAt = this.now(); await this._persist(job);
        return publicJob(job);
    }

    async exportBusinessPlan(id, format, ownerId = 'local-owner') {
        await this.get(id, ownerId); const job = this.jobs.get(id);
        if (job.status !== 'completed') throw new Error('The initial business plan must finish before export');
        return this.exportService.export(job, format, ownerId);
    }

    async prepareArbiteriumHandoff(id, ownerId = 'local-owner') {
        await this.get(id, ownerId); const job = this.jobs.get(id);
        if (job.status !== 'completed') throw new Error('The initial business plan must finish before Arbiterium handoff');
        const workflow = buildBusinessArbiteriumWorkflow(job); job.arbiteriumHandoffs ||= []; job.arbiteriumHandoffs.push(workflow); job.arbiteriumHandoffs = job.arbiteriumHandoffs.slice(-10); job.updatedAt = this.now(); await this._persist(job);
        return { job: publicJob(job), workflow };
    }

    async getVersion(id, version, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        const number = Number(version);
        if (number === job.collaboration.versions.length + 1) return { version: number, plan: job.plan, current: true };
        const entry = job.collaboration.versions.find(item => item.version === number);
        if (!entry) return null;
        return { ...entry, current: false };
    }

    async diffVersion(id, version, ownerId = 'local-owner') {
        const historical = await this.getVersion(id, version, ownerId);
        if (!historical) return null;
        const job = this.jobs.get(id);
        const oldLines = new Set(String(historical.plan || '').split('\n'));
        const newLines = new Set(String(job.plan || '').split('\n'));
        const added = [...newLines].filter(line => line && !oldLines.has(line));
        const removed = [...oldLines].filter(line => line && !newLines.has(line));
        return { version: Number(version), currentVersion: job.collaboration.versions.length + 1, addedCount: added.length, removedCount: removed.length, added: added.slice(0, 80), removed: removed.slice(0, 80) };
    }

    async restoreVersion(id, version, ownerId = 'local-owner') {
        const historical = await this.getVersion(id, version, ownerId);
        if (!historical || historical.current) throw new Error('Historical version not found');
        const job = this.jobs.get(id);
        const archiveVersion = job.collaboration.versions.length + 1;
        job.collaboration.versions.push({ id: crypto.randomUUID(), version: archiveVersion, plan: job.plan, createdAt: this.now(), reason: `Before restoring version ${version}` });
        job.plan = historical.plan;
        job.updatedAt = this.now();
        job.collaboration.messages.push({ id: crypto.randomUUID(), role: 'assistant', createdAt: this.now(), content: `Restored version ${version}. The plan that was current is preserved as version ${archiveVersion}.` });
        await this._persist(job);
        return publicJob(job);
    }

    async createScenario(id, input = {}, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        if (job.status !== 'completed') throw new Error('The initial business plan must finish before scenarios are created');
        const name = clip(String(input.name || `Scenario ${job.scenarios.length + 1}`).trim(), 120);
        const assumptions = normalizeFinancialAssumptions({ ...job.financialModel.assumptions, ...(input.assumptions || {}) });
        const model = buildFinancialModel(assumptions);
        const scenario = { id: crypto.randomUUID(), name, question: clip(input.question || '', 1200), assumptions, financialModel: model, createdAt: this.now(), status: 'ready' };
        job.scenarios.push(scenario);
        job.updatedAt = this.now();
        await this._persist(job);
        return scenario;
    }

    async updateOperatingWorkspace(id, action = {}, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        const job = this.jobs.get(id);
        job.operatingWorkspace ||= createOperatingWorkspace(job.profile, job.financialModel);
        const collection = action.collection;
        if (!['decisions', 'assumptions', 'experiments', 'milestones', 'kpis', 'tasks'].includes(collection)) throw new Error('Unknown operating collection');
        if (action.operation === 'add') {
            const entry = { id: crypto.randomUUID(), type: collection.replace(/s$/, ''), title: clip(action.item?.title || 'Untitled item', 500), status: 'open', owner: 'Founder', createdAt: this.now(), ...(action.item || {}) };
            job.operatingWorkspace[collection].push(entry);
        } else if (action.operation === 'remove') {
            const index = job.operatingWorkspace[collection].findIndex(item => item.id === action.id);
            if (index < 0) throw new Error('Operating item not found');
            job.operatingWorkspace[collection].splice(index, 1);
        } else {
            updateOperatingItem(job.operatingWorkspace, collection, action.id, action.patch || {});
        }
        job.operatingWorkspace.updatedAt = this.now();
        job.updatedAt = this.now();
        await this._persist(job);
        return job.operatingWorkspace;
    }

    async delete(id, ownerId = 'local-owner') {
        await this.get(id, ownerId);
        this.controllers.get(id)?.abort();
        this.jobs.delete(id);
        try { await fs.unlink(this._jobPath(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return true;
    }

    _assertOwner(job, ownerId) {
        if (job.ownerId && job.ownerId !== String(ownerId || 'local-owner')) {
            const error = new Error('Business plan job not found');
            error.code = 'NOT_FOUND';
            throw error;
        }
    }

    _scheduleResume(job) {
        if (this.resumeScheduled.has(job.id)) return;
        this.resumeScheduled.add(job.id);
        job.status = 'queued';
        setImmediate(() => this.run(job.id).catch(() => this.resumeScheduled.delete(job.id)));
    }

    _scheduleRevisionResume(job, revision) {
        revision.status = 'queued';
        setImmediate(() => this.runRevision(job.id, revision.id).catch(() => {}));
    }

    _jobPath(id) {
        const safe = String(id).replace(/[^a-zA-Z0-9-]/g, '');
        return path.join(this.jobDir, `${safe}.json`);
    }

    async _persist(job) {
        await fs.mkdir(this.jobDir, { recursive: true });
        const target = this._jobPath(job.id);
        const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temp, JSON.stringify(job, null, 2), 'utf8');
        await fs.rename(temp, target);
    }
}

export default BusinessPlanOrchestrator;
