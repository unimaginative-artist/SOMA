// AXIS OPS — Project management workspace view
// Ported from design bundle into SOMA's React codebase.

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAxis } from './AxisContext';

// ── Design tokens ─────────────────────────────────────────────────────────────
const MODES = {
  general:     { label: 'General',     hue: 260, lex: 'GENERAL',     glossary: { signal: 'Open',     tension: 'Blocked',     drift: 'Overdue'  } },
  operations:  { label: 'Operations',  hue: 340, lex: 'OPERATIONS',  glossary: { signal: 'Signal',   tension: 'Tension',     drift: 'Drift'   } },
  finance:     { label: 'Finance',     hue: 145, lex: 'CAPITAL',     glossary: { signal: 'Exposure', tension: 'Variance',    drift: 'Slippage'} },
  audit:       { label: 'Audit',       hue: 220, lex: 'EVIDENCE',    glossary: { signal: 'Anomaly',  tension: 'Discrepancy', drift: 'Stale'   } },
  creative:    { label: 'Creative',    hue:  35, lex: 'STUDIO',      glossary: { signal: 'Spark',    tension: 'Friction',    drift: 'Cooling' } },
  engineering: { label: 'Engineering', hue: 200, lex: 'SYSTEMS',     glossary: { signal: 'Pressure', tension: 'Conflict',    drift: 'Lag'     } },
  science:     { label: 'Science',     hue: 200, lex: 'RESEARCH',    glossary: { signal: 'Signal',   tension: 'Tension',     drift: 'Drift'   } },
};

// workspace type → mode key mapping
const TYPE_TO_MODE = {
  general: 'general',
  operations: 'operations', finance: 'finance', audit: 'audit',
  creative: 'creative', engineering: 'engineering', science: 'science',
};

const MODE_DESCRIPTIONS = {
  general: 'Tracks normal project flow without specialized terminology.',
  operations: 'Tracks delivery flow, blockers, and work drift.',
  finance: 'Tracks exposure, variance, and review-ready evidence.',
  audit: 'Tracks anomalies, discrepancies, and stale proof.',
  creative: 'Tracks sparks, friction, and cooling momentum.',
  engineering: 'Tracks system pressure, conflicts, and lag.',
  science: 'Tracks signal quality, tension, and reproducible evidence.',
};

const PROJECT_TEMPLATES = {
  general: [
    { id: 'blank', name: 'Blank Project', summary: 'A clean project with no starter tasks.', description: '', tasks: [] },
    { id: 'checklist', name: 'Checklist Project', summary: 'Simple planning, execution, and review flow.', description: 'General checklist project for lightweight planning and delivery.', tasks: [
      { title: 'Define the outcome', priority: 'high', dueDays: 1, description: 'Write the concrete result this project should produce.' },
      { title: 'List required work items', priority: 'medium', dueDays: 2, description: 'Break the project into small tasks that can be assigned or completed.' },
      { title: 'Review completion criteria', priority: 'medium', dueDays: 5, description: 'Confirm what must be true before this project is considered done.' },
    ] },
    { id: 'file-review', name: 'File Review', summary: 'Collect, inspect, and summarize a set of files.', description: 'File review project for collecting source material, extracting signal, and producing a summary.', tasks: [
      { title: 'Upload source files', priority: 'high', dueDays: 1, description: 'Add every relevant file to this project file area.' },
      { title: 'Run file intelligence scan', priority: 'high', dueDays: 1, description: 'Index and inspect uploaded files for searchable project context.' },
      { title: 'Write review summary', priority: 'medium', dueDays: 3, description: 'Summarize findings, risks, and recommended follow-up.' },
    ] },
  ],
  operations: [
    { id: 'launch-plan', name: 'Launch Plan', summary: 'Milestones, owners, blockers, and handoffs.', description: 'Operational launch plan focused on milestone control, owner clarity, and blocker removal.', tasks: [
      { title: 'Confirm launch objective and date', priority: 'high', dueDays: 1, description: 'Define launch target, owner, deadline, and success criteria.' },
      { title: 'Map owners and handoffs', priority: 'high', dueDays: 2, description: 'Identify every dependency, handoff, and accountable owner.' },
      { title: 'Create blocker review cadence', priority: 'medium', dueDays: 2, description: 'Set a recurring process for surfacing and resolving launch blockers.' },
      { title: 'Prepare launch readiness review', priority: 'medium', dueDays: 5, description: 'Collect final checks, open risks, and go/no-go notes.' },
    ] },
    { id: 'incident-followup', name: 'Incident Follow-up', summary: 'Timeline, cause, fixes, and prevention.', description: 'Post-incident follow-up for timeline reconstruction, root-cause review, and prevention work.', tasks: [
      { title: 'Reconstruct incident timeline', priority: 'high', dueDays: 1, description: 'Document what happened, when it happened, and who observed it.' },
      { title: 'Identify root cause and contributing factors', priority: 'high', dueDays: 2, description: 'Separate direct cause from process or monitoring gaps.' },
      { title: 'Assign corrective actions', priority: 'high', dueDays: 3, description: 'Create owners and deadlines for every prevention item.' },
      { title: 'Publish incident summary', priority: 'medium', dueDays: 5, description: 'Write a concise summary for stakeholders and future reference.' },
    ] },
    { id: 'process-improvement', name: 'Process Improvement', summary: 'Find friction, test changes, measure outcome.', description: 'Operations project for improving an existing process with measurable before/after evidence.', tasks: [
      { title: 'Document current process', priority: 'medium', dueDays: 2, description: 'Capture current steps, owners, and pain points.' },
      { title: 'Identify highest-friction step', priority: 'high', dueDays: 3, description: 'Choose the step with the biggest time, quality, or coordination cost.' },
      { title: 'Run improvement trial', priority: 'medium', dueDays: 7, description: 'Test a bounded process change before rolling it out broadly.' },
      { title: 'Measure before/after impact', priority: 'medium', dueDays: 10, description: 'Compare cycle time, error rate, or stakeholder load.' },
    ] },
  ],
  engineering: [
    { id: 'feature-build', name: 'Feature Build', summary: 'Spec, implementation, QA, and release.', description: 'Engineering feature build with a clear spec, implementation path, verification, and release notes.', tasks: [
      { title: 'Write feature spec', priority: 'high', dueDays: 1, description: 'Define behavior, edge cases, non-goals, and acceptance criteria.' },
      { title: 'Map implementation files and APIs', priority: 'high', dueDays: 2, description: 'Identify components, server routes, data contracts, and migration risk.' },
      { title: 'Implement core behavior', priority: 'high', dueDays: 5, description: 'Build the smallest complete version that satisfies the spec.' },
      { title: 'Add verification coverage', priority: 'medium', dueDays: 6, description: 'Add targeted tests or smoke checks for the changed behavior.' },
      { title: 'Prepare release notes', priority: 'low', dueDays: 7, description: 'Summarize user-facing behavior and known limitations.' },
    ] },
    { id: 'bug-sweep', name: 'Bug Sweep', summary: 'Repro, isolate, fix, prevent recurrence.', description: 'Bug sweep project for reproducing failures, isolating causes, and preventing recurrence.', tasks: [
      { title: 'Collect failing cases', priority: 'high', dueDays: 1, description: 'Capture screenshots, logs, reproduction steps, and affected users.' },
      { title: 'Isolate root cause', priority: 'high', dueDays: 2, description: 'Trace the failure to code, data, state, or environment.' },
      { title: 'Patch highest-impact bugs', priority: 'high', dueDays: 4, description: 'Fix the issues with the biggest user or stability impact first.' },
      { title: 'Add regression checks', priority: 'medium', dueDays: 5, description: 'Add tests or smoke checks so the same bug is caught earlier next time.' },
    ] },
    { id: 'release-plan', name: 'Release Plan', summary: 'Cut, validate, ship, monitor.', description: 'Release plan for coordinating validation, rollout, and post-release monitoring.', tasks: [
      { title: 'Confirm release scope', priority: 'high', dueDays: 1, description: 'Freeze the release candidate and list included changes.' },
      { title: 'Run release validation', priority: 'high', dueDays: 2, description: 'Run build, smoke, and critical-path checks.' },
      { title: 'Prepare rollback notes', priority: 'medium', dueDays: 2, description: 'Document how to revert if the release causes problems.' },
      { title: 'Monitor post-release signals', priority: 'medium', dueDays: 4, description: 'Watch logs, user reports, and performance after release.' },
    ] },
  ],
  finance: [
    { id: 'budget-review', name: 'Budget Review', summary: 'Budget lines, approvals, and variance notes.', description: 'Finance project for reviewing budget lines, ownership, approvals, and variance evidence.', tasks: [
      { title: 'Upload budget source files', priority: 'high', dueDays: 1, description: 'Attach current budget sheets, invoices, and supporting exports.' },
      { title: 'Identify variance drivers', priority: 'high', dueDays: 2, description: 'Find line items with material deviation from plan.' },
      { title: 'Collect approval evidence', priority: 'medium', dueDays: 3, description: 'Attach approval notes, owners, and decision history.' },
      { title: 'Export finance review workbook', priority: 'medium', dueDays: 5, description: 'Generate a clean workbook package for review.' },
    ] },
    { id: 'forecast-pack', name: 'Forecast Pack', summary: 'Assumptions, ranges, scenarios, and review.', description: 'Forecast pack project for assumptions, scenarios, and decision-ready reporting.', tasks: [
      { title: 'Define forecast assumptions', priority: 'high', dueDays: 1, description: 'Document source assumptions and uncertainty ranges.' },
      { title: 'Create base, upside, and downside cases', priority: 'high', dueDays: 3, description: 'Build scenario structure and compare drivers.' },
      { title: 'Review sensitivity points', priority: 'medium', dueDays: 4, description: 'Identify which assumptions most affect the forecast.' },
      { title: 'Prepare executive summary', priority: 'medium', dueDays: 5, description: 'Compress findings into a decision-ready summary.' },
    ] },
    { id: 'approval-workflow', name: 'Approval Workflow', summary: 'Request, evidence, approvers, and decision log.', description: 'Approval workflow for tracking financial requests, required evidence, and final decisions.', tasks: [
      { title: 'Capture approval request', priority: 'high', dueDays: 1, description: 'Write the request, amount, business reason, and owner.' },
      { title: 'Attach supporting evidence', priority: 'high', dueDays: 2, description: 'Add quotes, invoices, comparisons, or other supporting files.' },
      { title: 'Route to approvers', priority: 'medium', dueDays: 3, description: 'Assign the decision path and required sign-offs.' },
      { title: 'Record final decision', priority: 'medium', dueDays: 5, description: 'Store approval, denial, or revision decision with rationale.' },
    ] },
  ],
  audit: [
    { id: 'evidence-review', name: 'Evidence Review', summary: 'Collect, validate, and cite evidence.', description: 'Audit project for evidence collection, validation, gaps, and review-ready citations.', tasks: [
      { title: 'Define audit question', priority: 'high', dueDays: 1, description: 'State the control, claim, or process being tested.' },
      { title: 'Collect evidence files', priority: 'high', dueDays: 2, description: 'Attach policies, logs, exports, screenshots, and supporting documents.' },
      { title: 'Validate evidence freshness', priority: 'high', dueDays: 3, description: 'Check whether evidence is current, complete, and attributable.' },
      { title: 'Write findings and gaps', priority: 'medium', dueDays: 5, description: 'Document supported conclusions and unresolved evidence gaps.' },
    ] },
    { id: 'control-test', name: 'Control Test', summary: 'Control objective, sample, result, exception.', description: 'Control test project for structured audit testing and exception tracking.', tasks: [
      { title: 'Define control objective', priority: 'high', dueDays: 1, description: 'Write the risk addressed and expected control behavior.' },
      { title: 'Select sample set', priority: 'high', dueDays: 2, description: 'Choose representative samples and document selection criteria.' },
      { title: 'Run test procedure', priority: 'high', dueDays: 4, description: 'Execute the control test and record pass/fail evidence.' },
      { title: 'Document exceptions', priority: 'medium', dueDays: 5, description: 'Record exceptions, owners, and remediation needs.' },
    ] },
    { id: 'risk-finding', name: 'Risk Finding', summary: 'Risk, impact, cause, remediation.', description: 'Audit risk finding project for turning evidence into a clear remediation path.', tasks: [
      { title: 'State finding and risk', priority: 'high', dueDays: 1, description: 'Summarize the issue, risk, and affected area.' },
      { title: 'Attach supporting evidence', priority: 'high', dueDays: 2, description: 'Link the records that support the finding.' },
      { title: 'Define remediation owner', priority: 'medium', dueDays: 3, description: 'Assign accountable owner and target date.' },
      { title: 'Verify remediation evidence', priority: 'medium', dueDays: 10, description: 'Confirm whether remediation was completed and documented.' },
    ] },
  ],
  creative: [
    { id: 'campaign', name: 'Campaign', summary: 'Brief, concepts, assets, review, launch.', description: 'Creative campaign project for briefs, concept development, asset review, and launch packaging.', tasks: [
      { title: 'Write creative brief', priority: 'high', dueDays: 1, description: 'Define audience, promise, tone, channels, and constraints.' },
      { title: 'Develop concept directions', priority: 'high', dueDays: 3, description: 'Create several distinct directions before choosing one.' },
      { title: 'Prepare asset list', priority: 'medium', dueDays: 4, description: 'List required images, copy, video, posts, and variants.' },
      { title: 'Run creative review', priority: 'medium', dueDays: 6, description: 'Review for clarity, taste, accuracy, and brand fit.' },
    ] },
    { id: 'story-project', name: 'Story Project', summary: 'Premise, outline, draft, revision.', description: 'Story project for premise development, outlining, drafting, and revision.', tasks: [
      { title: 'Define premise and emotional promise', priority: 'high', dueDays: 1, description: 'Write what the story is about and what it should make the reader feel.' },
      { title: 'Build outline', priority: 'high', dueDays: 3, description: 'Map major turns, character pressure, and ending direction.' },
      { title: 'Draft first section', priority: 'medium', dueDays: 5, description: 'Write the first complete scene or chapter segment.' },
      { title: 'Run revision pass', priority: 'medium', dueDays: 7, description: 'Improve clarity, pacing, voice, and continuity.' },
    ] },
    { id: 'asset-review', name: 'Asset Review', summary: 'Collect, compare, tag, and approve assets.', description: 'Creative asset review project for organizing images, art, copy, or media before publishing.', tasks: [
      { title: 'Upload asset candidates', priority: 'high', dueDays: 1, description: 'Attach candidate images, drafts, copy, or source files.' },
      { title: 'Tag strongest assets', priority: 'medium', dueDays: 2, description: 'Mark the best assets by use case, quality, and fit.' },
      { title: 'Document revision notes', priority: 'medium', dueDays: 3, description: 'Write what needs editing before final use.' },
      { title: 'Approve final set', priority: 'medium', dueDays: 5, description: 'Choose the final assets and usage notes.' },
    ] },
  ],
  science: [
    { id: 'literature-review', name: 'Literature Review', summary: 'Question, papers, evidence, synthesis.', description: 'Research project for collecting papers, extracting evidence, and writing a synthesis.', tasks: [
      { title: 'Define research question', priority: 'high', dueDays: 1, description: 'State the exact question and what evidence would answer it.' },
      { title: 'Collect source papers', priority: 'high', dueDays: 2, description: 'Attach papers, abstracts, datasets, or links for review.' },
      { title: 'Extract claims and evidence', priority: 'high', dueDays: 4, description: 'Pull key claims, sample sizes, methods, and limitations.' },
      { title: 'Write synthesis notes', priority: 'medium', dueDays: 6, description: 'Summarize consensus, disagreement, gaps, and next experiments.' },
    ] },
    { id: 'experiment', name: 'Experiment', summary: 'Hypothesis, protocol, results, conclusion.', description: 'Experiment project for hypothesis testing, protocol control, and result interpretation.', tasks: [
      { title: 'Write falsifiable hypothesis', priority: 'high', dueDays: 1, description: 'State what result would support or refute the idea.' },
      { title: 'Define protocol and controls', priority: 'high', dueDays: 2, description: 'Document method, variables, controls, and stopping rules.' },
      { title: 'Collect results', priority: 'medium', dueDays: 7, description: 'Record observations, data, and deviations from protocol.' },
      { title: 'Analyze and write conclusion', priority: 'medium', dueDays: 9, description: 'Compare results to hypothesis and note limitations.' },
    ] },
    { id: 'paper-draft', name: 'Paper Draft', summary: 'Abstract, methods, evidence, discussion.', description: 'Paper draft project for converting research into a structured, paper-ready manuscript.', tasks: [
      { title: 'Draft abstract and thesis', priority: 'high', dueDays: 1, description: 'Write the central claim and contribution without overclaiming.' },
      { title: 'Assemble methods and evidence', priority: 'high', dueDays: 3, description: 'Collect methods, data, citations, and reproducibility notes.' },
      { title: 'Draft results section', priority: 'medium', dueDays: 5, description: 'Present findings clearly with caveats and limits.' },
      { title: 'Draft discussion and limitations', priority: 'medium', dueDays: 7, description: 'Explain meaning, constraints, and future work.' },
    ] },
  ],
};

function getWorkspaceMode(workspaceId, workspaceType) {
  const fallback = TYPE_TO_MODE[workspaceType] || 'general';
  if (!workspaceId || typeof localStorage === 'undefined') return fallback;
  const stored = localStorage.getItem(`axis_workspace_mode_${workspaceId}`) || localStorage.getItem(`axis_wstype_${workspaceId}`);
  return MODES[stored] ? stored : fallback;
}

function templatesForMode(modeKey) {
  const modeTemplates = PROJECT_TEMPLATES[modeKey] || [];
  const base = PROJECT_TEMPLATES.general || [];
  const blank = base.find(t => t.id === 'blank');
  const merged = [blank, ...modeTemplates, ...base].filter(Boolean);
  const seen = new Set();
  return merged.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function dueDateFromDays(days) {
  if (!Number.isFinite(Number(days))) return null;
  const date = new Date();
  date.setDate(date.getDate() + Number(days));
  date.setHours(17, 0, 0, 0);
  return date.getTime();
}

function templateChannels(template = {}, modeKey = 'general') {
  const common = [{ name: 'decisions', type: 'text', description: 'Decision log and project calls.' }];
  const byMode = {
    general: [{ name: 'files', type: 'text', description: 'File review notes and upload context.' }],
    operations: [{ name: 'handoffs', type: 'text', description: 'Owners, handoffs, blockers, and readiness notes.' }],
    engineering: [{ name: 'build', type: 'text', description: 'Implementation notes, bugs, PRs, and release risk.' }],
    finance: [{ name: 'evidence', type: 'text', description: 'Budget evidence, approvals, variance notes, and exports.' }],
    audit: [{ name: 'evidence', type: 'text', description: 'Controls, samples, exceptions, and remediation proof.' }],
    creative: [{ name: 'review', type: 'text', description: 'Creative review, revisions, and asset direction.' }],
    science: [{ name: 'research', type: 'text', description: 'Papers, methods, hypotheses, and reproducibility notes.' }],
  };
  const templateSpecific = template.id === 'blank' ? [] : [{ name: template.id, type: 'text', description: `${template.name} working channel.` }];
  const merged = [...common, ...(byMode[modeKey] || byMode.general), ...templateSpecific];
  const seen = new Set(['general']);
  return merged.filter(ch => {
    const key = ch.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function templateFileBuckets(template = {}, modeKey = 'general') {
  const base = ['Source Files', 'Exports', 'SOMA Briefs'];
  const byMode = {
    operations: ['Runbooks', 'Readiness Evidence'],
    engineering: ['Specs', 'Test Evidence', 'Release Notes'],
    finance: ['Budgets', 'Approvals', 'Variance Evidence'],
    audit: ['Control Evidence', 'Samples', 'Findings'],
    creative: ['Assets', 'Drafts', 'Finals'],
    science: ['Papers', 'Datasets', 'Methods'],
    general: ['References'],
  };
  return [...base, ...(byMode[modeKey] || byMode.general), template.name].filter(Boolean);
}

// ── Mock data (from design bundle) ───────────────────────────────────────────
const PEOPLE = [
  { id: 'p01', name: 'Naomi Okafor',    handle: '@naomi',   role: 'Eng Lead',   team: 'Atlas',  load: 0.82, momentum: 0.91, focus: 'Auth migration' },
  { id: 'p02', name: 'Idris Vassar',    handle: '@idris',   role: 'Staff Eng',  team: 'Atlas',  load: 0.64, momentum: 0.74, focus: 'Token rotation' },
  { id: 'p03', name: 'Mei Tanaka',      handle: '@mei',     role: 'Design',     team: 'Beacon', load: 0.71, momentum: 0.62, focus: 'Onboarding v3' },
  { id: 'p04', name: 'Jules Marchetti', handle: '@jules',   role: 'PM',         team: 'Beacon', load: 0.55, momentum: 0.80, focus: 'Launch coord' },
  { id: 'p05', name: 'Søren Brandt',    handle: '@soren',   role: 'SRE',        team: 'Vega',   load: 0.93, momentum: 0.41, focus: 'Incident #4421' },
  { id: 'p06', name: 'Anu Ravi',        handle: '@anu',     role: 'Data',       team: 'Vega',   load: 0.46, momentum: 0.88, focus: 'Forecast model' },
  { id: 'p07', name: 'Lior Schwarz',    handle: '@lior',    role: 'Finance',    team: 'Helix',  load: 0.68, momentum: 0.70, focus: 'Q3 close' },
  { id: 'p08', name: 'Priya Khanna',    handle: '@priya',   role: 'Legal',      team: 'Helix',  load: 0.39, momentum: 0.66, focus: 'Vendor review' },
  { id: 'p09', name: 'Esteban Ríos',    handle: '@esteban', role: 'Eng',        team: 'Atlas',  load: 0.77, momentum: 0.58, focus: 'CDN edges' },
  { id: 'p10', name: 'Hye-Jin Park',    handle: '@hyejin',  role: 'Research',   team: 'Beacon', load: 0.34, momentum: 0.79, focus: 'Persona study' },
  { id: 'p11', name: 'Tomás Werner',    handle: '@tomas',   role: 'Ops',        team: 'Vega',   load: 0.61, momentum: 0.55, focus: 'Capacity plan' },
  { id: 'p12', name: 'Adaeze Mbeki',    handle: '@ada',     role: 'Marketing',  team: 'Beacon', load: 0.58, momentum: 0.82, focus: 'Launch comms' },
];

const PROJECTS = [
  {
    id: 'atlas', code: 'ATL-04', name: 'Atlas — Identity Rebuild',
    summary: 'Re-architect auth substrate; SSO, MFA, session covenants.',
    owner: 'p01', team: ['p01','p02','p09'], priority: 'P0',
    health: 0.62, momentum: 0.74, tension: 0.41, velocity: 0.68, successProb: 0.72,
    blockers: 2, activeTasks: 14, completedTasks: 38, risk: 'medium', drift: -0.04, daysLeft: 24, phase: 'Build', last: '3m ago',
    spark: [0.42,0.45,0.5,0.48,0.52,0.58,0.6,0.62,0.6,0.64,0.66,0.68,0.7,0.74,0.78,0.74,0.72,0.7,0.72,0.74,0.76,0.74,0.72,0.74,0.76,0.74,0.74,0.74],
    insights: [
      { kind: 'risk',    text: 'Session covenant work blocked on legal review of cookie policy — 6 days latent.', conf: 0.88 },
      { kind: 'fatigue', text: 'Naomi shows 4-day sustained overload; recommend reassigning #ATL-217 to Idris.',  conf: 0.71 },
      { kind: 'pattern', text: 'Velocity tracks last cycle 14% above plan; safe to pull in MFA work.',           conf: 0.66 },
    ],
  },
  {
    id: 'beacon', code: 'BCN-09', name: 'Beacon — Onboarding v3',
    summary: 'First-mile redesign for activation. Cross-team launch.',
    owner: 'p04', team: ['p03','p04','p10','p12'], priority: 'P0',
    health: 0.84, momentum: 0.88, tension: 0.18, velocity: 0.82, successProb: 0.86,
    blockers: 0, activeTasks: 9, completedTasks: 51, risk: 'low', drift: 0.09, daysLeft: 11, phase: 'Launch', last: 'just now',
    spark: [0.5,0.52,0.55,0.6,0.62,0.65,0.66,0.68,0.7,0.72,0.74,0.76,0.78,0.8,0.82,0.84,0.84,0.85,0.86,0.86,0.87,0.88,0.88,0.88,0.88,0.88,0.88,0.88],
    insights: [
      { kind: 'accel',   text: 'Activation lift +14% in canary; launch ahead of plan by 3 days.',               conf: 0.92 },
      { kind: 'pattern', text: "Persona study (Hye-Jin) converged with Mei's design language — low rework risk.",conf: 0.78 },
    ],
  },
  {
    id: 'vega', code: 'VGA-02', name: 'Vega — Forecast Engine',
    summary: 'Capacity model + incident-aware throughput forecasting.',
    owner: 'p05', team: ['p05','p06','p11'], priority: 'P1',
    health: 0.34, momentum: 0.28, tension: 0.81, velocity: 0.32, successProb: 0.41,
    blockers: 5, activeTasks: 21, completedTasks: 12, risk: 'critical', drift: -0.21, daysLeft: 6, phase: 'Build', last: '18m ago',
    spark: [0.6,0.58,0.56,0.54,0.5,0.48,0.46,0.44,0.42,0.4,0.42,0.38,0.36,0.34,0.34,0.32,0.34,0.32,0.3,0.32,0.3,0.3,0.28,0.3,0.28,0.28,0.28,0.28],
    insights: [
      { kind: 'risk',  text: 'Søren on incident rotation 9 of last 14 days. Project at standstill.',       conf: 0.95 },
      { kind: 'risk',  text: "Anu's model depends on Atlas auth tokens — chain blocker.",                   conf: 0.84 },
      { kind: 'pivot', text: 'Recommend descope to capacity-only; defer incident-aware logic to Q1.',      conf: 0.79 },
    ],
  },
  {
    id: 'helix', code: 'HLX-11', name: 'Helix — Q3 Close',
    summary: 'Consolidated close, vendor reconciliations, audit trail lock.',
    owner: 'p07', team: ['p07','p08'], priority: 'P1',
    health: 0.76, momentum: 0.61, tension: 0.31, velocity: 0.66, successProb: 0.78,
    blockers: 1, activeTasks: 7, completedTasks: 24, risk: 'low', drift: 0.02, daysLeft: 9, phase: 'Close', last: '42m ago',
    spark: [0.5,0.52,0.54,0.56,0.58,0.6,0.62,0.6,0.62,0.64,0.62,0.6,0.62,0.64,0.62,0.6,0.62,0.6,0.62,0.6,0.62,0.6,0.6,0.62,0.6,0.61,0.61,0.61],
    insights: [
      { kind: 'pattern', text: 'Vendor variance within tolerance for 22 of 24 lines. Priya cleared FX wrap.', conf: 0.81 },
      { kind: 'risk',    text: 'One unresolved variance on Sun-Mar contract; suggest 30-min sync.',           conf: 0.62 },
    ],
  },
  {
    id: 'orion', code: 'ORN-07', name: 'Orion — Edge Compute',
    summary: 'Push compute to CDN edges; latency in EMEA + APAC.',
    owner: 'p02', team: ['p02','p09'], priority: 'P2',
    health: 0.58, momentum: 0.52, tension: 0.46, velocity: 0.5, successProb: 0.60,
    blockers: 1, activeTasks: 11, completedTasks: 19, risk: 'medium', drift: -0.01, daysLeft: 38, phase: 'Design', last: '2h ago',
    spark: [0.4,0.42,0.44,0.46,0.48,0.5,0.52,0.5,0.52,0.54,0.56,0.54,0.52,0.5,0.52,0.5,0.48,0.5,0.52,0.5,0.52,0.5,0.52,0.5,0.52,0.5,0.52,0.52],
    insights: [{ kind: 'pattern', text: 'Mostly steady. Consider pairing Esteban with someone for review velocity.', conf: 0.58 }],
  },
  {
    id: 'mira', code: 'MIR-01', name: 'Mira — Research Concierge',
    summary: 'AI-mediated user research synthesis across studies.',
    owner: 'p10', team: ['p10','p06'], priority: 'P2',
    health: 0.71, momentum: 0.83, tension: 0.22, velocity: 0.78, successProb: 0.77,
    blockers: 0, activeTasks: 6, completedTasks: 14, risk: 'low', drift: 0.06, daysLeft: 21, phase: 'Build', last: '11m ago',
    spark: [0.5,0.55,0.6,0.62,0.64,0.66,0.68,0.7,0.72,0.74,0.76,0.78,0.8,0.82,0.83,0.82,0.83,0.83,0.84,0.83,0.84,0.83,0.83,0.83,0.83,0.83,0.83,0.83],
    insights: [{ kind: 'accel', text: "Anu's embedding pipeline lifted synthesis quality by 31% in test set.", conf: 0.86 }],
  },
  {
    id: 'kepler', code: 'KPL-03', name: 'Kepler — Pricing Refit',
    summary: 'Tiered pricing + entitlement engine. Cross-functional.',
    owner: 'p07', team: ['p07','p08','p12'], priority: 'P1',
    health: 0.49, momentum: 0.44, tension: 0.62, velocity: 0.46, successProb: 0.52,
    blockers: 3, activeTasks: 17, completedTasks: 8, risk: 'high', drift: -0.08, daysLeft: 17, phase: 'Design', last: '1h ago',
    spark: [0.55,0.54,0.52,0.5,0.48,0.5,0.48,0.46,0.48,0.46,0.44,0.46,0.44,0.42,0.44,0.42,0.44,0.42,0.44,0.42,0.44,0.42,0.44,0.42,0.44,0.42,0.44,0.44],
    insights: [
      { kind: 'risk',  text: 'Adaeze and Lior disagree on positioning. 14 messages, 0 resolution.', conf: 0.81 },
      { kind: 'pivot', text: 'Propose 30-min decision sync; AI can pre-summarize positions.',       conf: 0.74 },
    ],
  },
  {
    id: 'sable', code: 'SBL-22', name: 'Sable — Trust Center',
    summary: 'SOC2 + customer-facing security portal.',
    owner: 'p08', team: ['p08','p02','p11'], priority: 'P2',
    health: 0.66, momentum: 0.58, tension: 0.27, velocity: 0.6, successProb: 0.68,
    blockers: 0, activeTasks: 8, completedTasks: 16, risk: 'low', drift: 0.01, daysLeft: 28, phase: 'Audit', last: '4h ago',
    spark: [0.5,0.52,0.54,0.56,0.58,0.6,0.58,0.6,0.58,0.6,0.58,0.6,0.58,0.6,0.58,0.6,0.58,0.58,0.6,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58],
    insights: [],
  },
];

const ATLAS_TASKS = [
  { id: 'ATL-201', title: 'Migrate session store to edge KV',     status: 'in_progress', owner: 'p01', priority: 'P0', gravity: 0.92, due: '+3d', age: 9, blockers: 0, aiNote: 'On track. Anu\'s replication tests pass.',          deps: 2, depsDone: 2 },
  { id: 'ATL-204', title: 'Cookie policy review — covenants',     status: 'blocked',     owner: 'p08', priority: 'P0', gravity: 0.88, due: '+1d', age: 6, blockers: 1, aiNote: 'BLOCKER: awaiting Priya legal review (6d stale).',  deps: 1, depsDone: 0 },
  { id: 'ATL-217', title: 'MFA enrollment flow — fallback paths', status: 'in_progress', owner: 'p01', priority: 'P1', gravity: 0.74, due: '+5d', age: 4, blockers: 0, aiNote: 'Naomi at 82% load. Consider reassign to Idris.',    deps: 0, depsDone: 0 },
  { id: 'ATL-220', title: 'Token rotation cadence + revocation',  status: 'review',      owner: 'p02', priority: 'P1', gravity: 0.68, due: '+2d', age: 3, blockers: 0, aiNote: 'Idris closed in 3d (vs 5d est). Strong work.',     deps: 1, depsDone: 1 },
  { id: 'ATL-228', title: 'CDN edge cache invalidation hooks',    status: 'todo',        owner: 'p09', priority: 'P2', gravity: 0.51, due: '+8d', age: 0, blockers: 0, aiNote: 'Depends on Orion-07. Defer 1w?',                   deps: 1, depsDone: 0 },
  { id: 'ATL-231', title: 'Audit log schema — append-only',       status: 'in_progress', owner: 'p02', priority: 'P1', gravity: 0.72, due: '+4d', age: 2, blockers: 0, aiNote: 'Aligns w/ Sable Trust Center work. Share design.',  deps: 0, depsDone: 0 },
  { id: 'ATL-235', title: 'SSO connector — Okta + Azure',         status: 'todo',        owner: null,  priority: 'P1', gravity: 0.66, due: '+9d', age: 0, blockers: 0, aiNote: 'Unassigned. Naomi or Esteban best fit.',            deps: 2, depsDone: 0 },
  { id: 'ATL-238', title: 'Threat model — session hijack vector', status: 'todo',        owner: null,  priority: 'P0', gravity: 0.81, due: '+6d', age: 0, blockers: 0, aiNote: 'Unassigned. Security review needed before launch.',  deps: 0, depsDone: 0 },
];

const ORG_PULSE = {
  momentum: 0.71, tension: 0.38, velocity: 0.66, throughput: 142,
  cycleDay: 9, cycleLen: 14, alignment: 0.78, people: 142, active: 87, briefingsToday: 18,
};

// ── Project-specific data ─────────────────────────────────────────────────────
const PROJECT_FILES = {
  atlas: [
    { id: 'f-design',   kind: 'folder', name: 'Design',         items: 6 },
    { id: 'f-spec',     kind: 'folder', name: 'Specifications', items: 12 },
    { id: 'f-eng',      kind: 'folder', name: 'Engineering',    items: 24, expanded: true, children: [
      { id: 'e-1', kind: 'file', name: 'Auth architecture.md',       ext: 'md',  size: '6.1 KB', author: 'p01', updated: '2h ago', selected: true },
      { id: 'e-2', kind: 'file', name: 'Session covenant spec.pdf',  ext: 'pdf', size: '1.8 MB', author: 'p08', updated: '1d ago' },
      { id: 'e-3', kind: 'file', name: 'MFA flow wireframes.fig',    ext: 'fig', size: '18 MB',  author: 'p01', updated: '3h ago' },
    ]},
    { id: 'f-research', kind: 'folder', name: 'Research', items: 4 },
    { id: 'f-meta',     kind: 'folder', name: '_meta',    items: 3 },
  ],
  beacon: [
    { id: 'f-launch',  kind: 'folder', name: 'Launch plan', items: 8 },
    { id: 'f-content', kind: 'folder', name: 'Content',     items: 18, expanded: true, children: [
      { id: 'c-1', kind: 'file', name: 'Welcome flow — copy.md',       ext: 'md',  size: '4.2 KB', author: 'p03', updated: '12m ago', selected: true },
      { id: 'c-2', kind: 'file', name: 'Activation deck v3.fig',            ext: 'fig', size: '24 MB',  author: 'p03', updated: '1h ago' },
      { id: 'c-3', kind: 'file', name: 'Persona study — synthesis.pdf',ext: 'pdf', size: '8.1 MB', author: 'p10', updated: '3h ago' },
      { id: 'c-4', kind: 'file', name: 'Email sequence.docx',               ext: 'doc', size: '320 KB', author: 'p12', updated: 'yesterday' },
    ]},
    { id: 'f-research', kind: 'folder', name: 'Research', items: 11 },
    { id: 'f-press',    kind: 'folder', name: 'Press',    items: 5 },
    { id: 'f-meta',     kind: 'folder', name: '_meta',    items: 2 },
  ],
  vega: [
    { id: 'f-model',     kind: 'folder', name: 'Model',    items: 14 },
    { id: 'f-incidents', kind: 'folder', name: 'Incidents',items: 31, expanded: true, children: [
      { id: 'v-1', kind: 'file', name: 'Incident #4421 post-mortem.md',ext: 'md',  size: '12 KB',  author: 'p05', updated: '6h ago', selected: true },
      { id: 'v-2', kind: 'file', name: 'Runbook — forecast fail.pdf',  ext: 'pdf', size: '2.4 MB', author: 'p06', updated: '2d ago' },
    ]},
    { id: 'f-runbooks',  kind: 'folder', name: 'Runbooks', items: 9 },
  ],
  helix: [
    { id: 'f-vendors', kind: 'folder', name: 'Vendors',         items: 24, expanded: true, children: [
      { id: 'h-1', kind: 'file', name: 'Sun-Mar contract.pdf',   ext: 'pdf', size: '3.2 MB', author: 'p07', updated: '1h ago', selected: true },
      { id: 'h-2', kind: 'file', name: 'FX reconciliation.docx', ext: 'doc', size: '840 KB', author: 'p08', updated: '3h ago' },
    ]},
    { id: 'f-recons', kind: 'folder', name: 'Reconciliations', items: 18 },
    { id: 'f-audit',  kind: 'folder', name: 'Audit trail',     items: 6 },
  ],
};

const PROJECT_CHAT = {
  atlas: [
    { id: 'm1', sender: 'axis', kind: 'ai', text: 'Cookie policy review still pending — 6 days latent. Escalating to Priya.', time: '09:14' },
    { id: 'm2', sender: 'p01', text: 'Token rotation v4 ready for review. Idris, can you sweep?', time: '09:32', side: 'right' },
    { id: 'm3', sender: 'p02', text: 'On it. Will have feedback by 14:00.', time: '09:35' },
    { id: 'm4', sender: 'p08', text: 'Legal cleared session covenant draft — ready to merge.', time: '11:20' },
  ],
  beacon: [
    { id: 'm1', sender: 'axis', kind: 'ai', text: 'Activation lift +14% in canary — launch advanceable by 3 days.', time: '11:24' },
    { id: 'm2', sender: 'p04', text: 'Confirming new copy — pushing to dev preview by EOD.', time: '11:42', side: 'right' },
    { id: 'm3', sender: 'p03', text: 'Just dropped the new activation deck. Mei is reviewing edge cases.', time: '12:08', attachment: 'Activation deck v3.fig' },
    { id: 'm4', sender: 'p10', text: 'Persona synthesis is in. 3 archetypes converged — sending to writers.', time: '12:22' },
    { id: 'm5', sender: 'p12', text: 'Email sequence locked. Need legal sign-off on opt-in copy.', time: '12:31' },
  ],
  vega: [
    { id: 'm1', sender: 'axis', kind: 'ai', text: 'Søren on incident rotation 9 of last 14 days. Project at standstill.', time: '08:42' },
    { id: 'm2', sender: 'p05', text: 'Back from incident #4421. Hot-fix shipped, post-mortem tomorrow.', time: '14:11', side: 'right' },
    { id: 'm3', sender: 'p06', text: 'Forecast model is blocked on auth tokens. Need Atlas folks to weigh in.', time: '14:15' },
  ],
  helix: [
    { id: 'm1', sender: 'axis', kind: 'ai', text: 'Vendor variance within tolerance for 22 of 24 lines. One outlier on Sun-Mar.', time: '10:30' },
    { id: 'm2', sender: 'p07', text: 'Reviewing Sun-Mar contract. Will reach out to vendor.', time: '11:02', side: 'right' },
    { id: 'm3', sender: 'p08', text: 'FX wrap reconciled — sending to audit folder.', time: '13:14' },
  ],
};

const BUBBLE_COLOR = {
  axis: { bg: 'oklch(0.45 0.18 350)', tx: '#fff' },
  p01:  { bg: 'oklch(0.55 0.16 220)', tx: '#fff' },
  p02:  { bg: 'oklch(0.55 0.16 290)', tx: '#fff' },
  p03:  { bg: 'oklch(0.55 0.16 290)', tx: '#fff' },
  p04:  { bg: 'oklch(0.55 0.16 290)', tx: '#fff' },
  p05:  { bg: 'oklch(0.62 0.20 30)',  tx: '#fff' },
  p06:  { bg: 'oklch(0.62 0.16 145)', tx: '#fff' },
  p07:  { bg: 'oklch(0.62 0.16 145)', tx: '#fff' },
  p08:  { bg: 'oklch(0.55 0.16 220)', tx: '#fff' },
  p10:  { bg: 'oklch(0.62 0.16 145)', tx: '#fff' },
  p12:  { bg: 'oklch(0.62 0.20 30)',  tx: '#fff' },
};

const FILE_ICON = {
  // Documents
  pdf:  { color: 'oklch(0.65 0.20 25)',  text: 'P'  },
  doc:  { color: 'oklch(0.65 0.16 220)', text: 'D'  },
  docx: { color: 'oklch(0.65 0.16 220)', text: 'D'  },
  ppt:  { color: 'oklch(0.65 0.18 30)',  text: 'P'  },
  pptx: { color: 'oklch(0.65 0.18 30)',  text: 'P'  },
  xls:  { color: 'oklch(0.65 0.18 145)', text: 'X'  },
  xlsx: { color: 'oklch(0.65 0.18 145)', text: 'X'  },
  csv:  { color: 'oklch(0.65 0.18 145)', text: 'C'  },
  // Text
  md:   { color: 'oklch(0.72 0.10 220)', text: 'M'  },
  txt:  { color: 'oklch(0.60 0.04 220)', text: 'T'  },
  rtf:  { color: 'oklch(0.60 0.04 220)', text: 'R'  },
  // Code
  js:   { color: 'oklch(0.75 0.16 85)',  text: 'JS' },
  ts:   { color: 'oklch(0.65 0.16 220)', text: 'TS' },
  jsx:  { color: 'oklch(0.72 0.16 200)', text: 'JX' },
  tsx:  { color: 'oklch(0.65 0.14 210)', text: 'TX' },
  py:   { color: 'oklch(0.65 0.14 240)', text: 'PY' },
  json: { color: 'oklch(0.70 0.10 85)',  text: '{}'  },
  yaml: { color: 'oklch(0.68 0.10 340)', text: 'YM' },
  yml:  { color: 'oklch(0.68 0.10 340)', text: 'YM' },
  sql:  { color: 'oklch(0.68 0.12 260)', text: 'SQ' },
  sh:   { color: 'oklch(0.60 0.08 145)', text: 'SH' },
  css:  { color: 'oklch(0.65 0.16 270)', text: 'CS' },
  html: { color: 'oklch(0.65 0.16 30)',  text: 'HT' },
  // Design
  fig:  { color: 'oklch(0.72 0.16 30)',  text: 'F'  },
  // Images
  png:  { color: 'oklch(0.70 0.12 310)', text: '🖼' },
  jpg:  { color: 'oklch(0.70 0.12 310)', text: '🖼' },
  jpeg: { color: 'oklch(0.70 0.12 310)', text: '🖼' },
  gif:  { color: 'oklch(0.70 0.12 310)', text: '🖼' },
  webp: { color: 'oklch(0.70 0.12 310)', text: '🖼' },
  svg:  { color: 'oklch(0.70 0.12 310)', text: '🖼' },
};

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function healthLabel(v) {
  if (v >= 0.75) return 'STABLE';
  if (v >= 0.55) return 'WATCH';
  if (v >= 0.40) return 'STRAIN';
  return 'CRITICAL';
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function healthColor(v) {
  if (v >= 0.75) return 'oklch(0.78 0.13 162)';
  if (v >= 0.55) return 'oklch(0.84 0.14 80)';
  if (v >= 0.40) return 'oklch(0.75 0.15 45)';
  return 'oklch(0.66 0.22 25)';
}
function riskColor(r) {
  return { low: 'oklch(0.78 0.13 162)', medium: 'oklch(0.84 0.14 80)', high: 'oklch(0.75 0.15 45)', critical: 'oklch(0.66 0.22 25)' }[r] || 'oklch(0.7 0 0)';
}
function priColor(p) {
  return { P0: 'oklch(0.66 0.22 25)', P1: 'oklch(0.84 0.14 80)', P2: 'oklch(0.78 0.10 220)' }[p] || '#5c6580';
}
function initials(name) { return name.split(' ').map(s => s[0]).slice(0,2).join(''); }
function personHue(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function mapMember(member) {
  if (!member) return null;
  return {
    id: member.user_id || member.id,
    name: member.user_name || member.name || 'Member',
    handle: member.user_name ? `@${member.user_name.replace(/\s+/g, '').toLowerCase()}` : '',
    role: member.role || 'contributor',
    joined_at: member.joined_at,
  };
}

function projectCode(project) {
  const stem = String(project.name || 'Project').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'PRJ';
  return `${stem}-${String(project.id || '').slice(-4).toUpperCase()}`;
}

function normalizeProject(project, tasks = [], members = []) {
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const activeTasks = tasks.filter(t => t.status !== 'done').length;
  const blockers = tasks.filter(t => t.status === 'blocked').length;
  const progress = tasks.length ? completedTasks / tasks.length : 0;
  const due = tasks
    .filter(t => t.status !== 'done' && t.due_date)
    .map(t => Number(t.due_date))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const daysLeft = due ? Math.ceil((due - Date.now()) / 86400000) : null;
  return {
    ...project,
    code: projectCode(project),
    summary: project.description || 'No project description yet.',
    phase: project.status || 'active',
    tasks,
    channels: project.channels || [],
    team: members.map(mapMember).filter(Boolean),
    owner: members.find(m => m.role === 'owner') ? mapMember(members.find(m => m.role === 'owner')) : null,
    completedTasks,
    activeTasks,
    blockers,
    progress,
    daysLeft,
    last: project.created_at ? new Date(project.created_at).toLocaleDateString() : '--',
  };
}

// ── Primitive components ──────────────────────────────────────────────────────

function SparkLine({ data, w = 96, h = 28, color, fill = true }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = Math.max(0.001, max - min);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${w},${h} L0,${h} Z`;
  const lastX = w, lastY = h - ((data[data.length-1] - min) / range) * (h - 2) - 1;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {fill && <path d={area} fill={color} opacity="0.10" />}
      <path d={line} stroke={color} strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="1.8" fill={color} />
    </svg>
  );
}

function StatusDot({ color, pulse = false, size = 6 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
      {pulse && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: 0.4, animation: 'axops-pulse 2s ease-in-out infinite' }} />}
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }} />
    </span>
  );
}

function Lbl({ children, color, className = '' }) {
  return (
    <span className={className} style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Geist Mono', monospace", color: color || '#5c6580' }}>
      {children}
    </span>
  );
}

function ReferenceText({ text, project, onOpenChannel, onOpenTask }) {
  const value = String(text || '');
  const pattern = /(https?:\/\/[^\s]+|\/api\/[^\s]+|[@#][a-zA-Z0-9._-]+)/g;
  const parts = value.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (/^(https?:\/\/|\/api\/)/.test(part)) {
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer"
          style={{ color: 'oklch(0.78 0.13 200)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {part}
        </a>
      );
    }
    const match = /^([@#])([a-zA-Z0-9._-]+)$/.exec(part);
    if (!match) return <React.Fragment key={index}>{part}</React.Fragment>;
    const [, prefix, rawToken] = match;
    const token = rawToken.toLowerCase();
    const channel = prefix === '#' ? (project?.channels || []).find(ch => String(ch.name || '').toLowerCase() === token) : null;
    const member = prefix === '@' ? (project?.team || []).find(m =>
      String(m.handle || '').replace(/^@/, '').toLowerCase() === token
      || String(m.name || '').replace(/\s+/g, '').toLowerCase() === token
    ) : null;
    const task = prefix === '@' ? (project?.tasks || []).find(t =>
      String(t.id || '').toLowerCase() === token
      || String(t.title || '').replace(/[^a-z0-9]/gi, '').toLowerCase().startsWith(token)
    ) : null;
    const clickable = channel || task || member;
    return (
      <button key={index} type="button" onClick={e => {
        e.stopPropagation();
        if (channel) onOpenChannel?.(channel);
        if (task) onOpenTask?.(task);
        if (member && !channel && !task) {
          window.dispatchEvent(new CustomEvent('axis:open-profile', { detail: { memberId: member.id, isSelf: false } }));
        }
      }} title={clickable ? 'Open reference' : 'Reference'}
        style={{ padding: 0, border: 0, background: 'none', color: clickable ? 'oklch(0.78 0.13 200)' : '#8b95aa', cursor: clickable ? 'pointer' : 'default', font: 'inherit' }}>
        {part}
      </button>
    );
  });
}

function parseSharedFileMessage(text) {
  const value = String(text || '');
  const name = /^File shared:\s*(.+)$/m.exec(value)?.[1]?.trim();
  const url = /(\/api\/workspace\/files\/[^ \n]+\/download)/.exec(value)?.[1];
  if (!name || !url) return null;
  const meta = value.split('\n').slice(2).join(' ').trim();
  return { name, url, meta };
}

function emitProjectChatFocus({ messageId, channelId, projectId }) {
  if (!messageId) return;
  window.dispatchEvent(new CustomEvent('axis:project-chat-focus', {
    detail: { messageId, channelId, projectId },
  }));
}

function PersonAvatar({ person, size = 24, ring = false }) {
  if (!person) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', border: '1px dashed #2d3548', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, color: '#2d3548', fontFamily: 'monospace' }}>?</div>
    );
  }
  const hue = personHue(person.id);
  return (
    <div title={person.name} style={{
      width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `oklch(0.35 0.04 ${hue})`, color: `oklch(0.92 0.08 ${hue})`,
      fontSize: size * 0.36, fontFamily: 'monospace', fontWeight: 500,
      boxShadow: ring ? '0 0 0 1.5px #07080b' : 'none',
    }}>
      {initials(person.name)}
    </div>
  );
}

function AvatarStack({ ids = [], size = 22, max = 4 }) {
  const people = ids.map(item => typeof item === 'object' ? item : PEOPLE.find(p => p.id === item)).filter(Boolean);
  const shown = people.slice(0, max), extra = people.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <PersonAvatar person={p} size={size} ring />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ width: size, height: size, borderRadius: '50%', marginLeft: -size * 0.3, background: '#1e2430', color: '#9ba5b7', fontSize: size * 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1.5px #07080b', fontFamily: 'monospace' }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

function SlimBar({ value, color, w = 60, h = 4 }) {
  return (
    <div style={{ width: w, height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${value * 100}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.5s' }} />
    </div>
  );
}

function DriftArrow({ value }) {
  const up = value > 0.01, dn = value < -0.01;
  const color = up ? 'oklch(0.78 0.13 162)' : dn ? 'oklch(0.75 0.15 45)' : '#2d3548';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontFamily: 'monospace', color }}>
      {up && '↑'}{dn && '↓'}{!up && !dn && '·'}
      {(up || dn) && `${up ? '+' : ''}${(value * 100).toFixed(0)}%`}
    </span>
  );
}

// ── Title Strip ───────────────────────────────────────────────────────────────
function TitleStrip({ workspaceName, modeKey, onModeChange, projects, tasks, user }) {
  const [modeOpen, setModeOpen] = useState(false);
  const mode = MODES[modeKey] || MODES.operations;
  const modeColor = `oklch(0.72 0.22 ${mode.hue})`;
  const modeDescription = MODE_DESCRIPTIONS[modeKey] || MODE_DESCRIPTIONS.operations;
  const totalBlockers = tasks.filter(t => t.status === 'blocked').length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '16px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#07080b' }}>
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 28, lineHeight: 1, letterSpacing: '-0.02em', color: '#e8edf5', margin: 0 }}>
          {workspaceName}
        </h1>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Geist Mono', monospace", fontSize: 9, letterSpacing: '0.1em' }}>
          <span style={{ color: modeColor }}>{mode.lex}</span>
          <span style={{ color: '#3b455a', letterSpacing: 0 }}>{modeDescription}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 28, fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot color={modeColor} pulse size={5} />
          <span style={{ color: '#5c6580', letterSpacing: '0.08em' }}>{mode.lex} WORKSPACE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#2d3548', letterSpacing: '0.08em' }}>PROJECTS</span>
          <span style={{ color: '#9ba5b7' }}>{projects.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#2d3548', letterSpacing: '0.08em' }}>BLOCKERS</span>
          <span style={{ color: totalBlockers > 0 ? 'oklch(0.75 0.15 45)' : 'oklch(0.78 0.13 162)' }}>{totalBlockers}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setModeOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 6, background: '#161b22', border: `1px solid color-mix(in oklch, ${modeColor} 42%, transparent)`, color: '#9ba5b7', fontSize: 12, cursor: 'pointer' }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: modeColor, boxShadow: `0 0 12px ${modeColor}` }} />
            <span>{mode.label}</span>
            <span style={{ color: '#2d3548' }}>▾</span>
          </button>
          {modeOpen && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 160, background: '#11141a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden', zIndex: 50, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              {Object.entries(MODES).map(([k, m]) => (
                <button key={k} onClick={() => { onModeChange(k); setModeOpen(false); }}
                  style={{ width: '100%', padding: '8px 12px', textAlign: 'left', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: k === modeKey ? '#e8edf5' : '#9ba5b7', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span>{m.label}</span>
                  {k === modeKey && <span style={{ color: modeColor, fontSize: 10 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
          <PersonAvatar person={user ? { id: user.id, name: user.name || user.handle || 'User' } : null} size={28} />
          <div>
            <div style={{ fontSize: 12, color: '#9ba5b7', lineHeight: 1.2 }}>{user?.name || 'User'}</div>
            <div style={{ fontSize: 9, color: '#2d3548', fontFamily: 'monospace', letterSpacing: '0.08em' }}>OWNER</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vitals Strip ──────────────────────────────────────────────────────────────
function VitalsStrip({ modeColor, modeKey, projects, tasks }) {
  const mode = MODES[modeKey] || MODES.operations;
  const completed = tasks.filter(t => t.status === 'done').length;
  const active = tasks.filter(t => t.status !== 'done').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const unassigned = tasks.filter(t => t.status !== 'done' && !t.assignee_id).length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.due_date && Number(t.due_date) < Date.now()).length;
  const stats = [
    { l: 'Projects',   v: projects.length, accent: true },
    { l: mode.glossary.signal, v: active },
    { l: 'Completed',   v: completed },
    { l: mode.glossary.tension, v: blocked },
    { l: 'Unassigned',  v: unassigned },
    { l: mode.glossary.drift, v: overdue },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      {stats.map((s, i) => (
        <div key={s.l} style={{ padding: '20px 28px', borderRight: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
          <Lbl>{s.l}</Lbl>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 44, lineHeight: 1, letterSpacing: '-0.02em', color: s.accent ? modeColor : '#e8edf5' }}>
              {s.v}
            </span>
            {s.suffix && <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#2d3548' }}>{s.suffix}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Projects Panel ────────────────────────────────────────────────────────────
function ProjectsPanel({ projects, onOpen, onCreate, modeColor, loading }) {
  const [sortBy, setSortBy] = useState('open');
  const [view, setView] = useState('table');

  const sorted = useMemo(() => {
    const arr = [...projects];
    if (sortBy === 'open') arr.sort((a, b) => b.activeTasks - a.activeTasks);
    if (sortBy === 'blocked') arr.sort((a, b) => b.blockers - a.blockers);
    if (sortBy === 'progress') arr.sort((a, b) => b.progress - a.progress);
    if (sortBy === 'recent') arr.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    return arr;
  }, [projects, sortBy]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Lbl>Projects</Lbl>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#2d3548' }}>· {projects.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, background: 'rgba(255,255,255,0.07)' }}>
            {[['table','Table'],['constellation','Map']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ padding: '4px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase', background: view === k ? '#1e2430' : 'transparent', color: view === k ? '#e8edf5' : '#5c6580', border: 'none', cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.07)', fontFamily: 'monospace', fontSize: 10 }}>
            <span style={{ color: '#2d3548', letterSpacing: '0.08em', marginRight: 4 }}>SORT</span>
            {['open', 'blocked', 'progress', 'recent'].map(k => (
              <button key={k} onClick={() => setSortBy(k)}
                style={{ padding: '4px 10px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.08em', background: sortBy === k ? '#1e2430' : 'transparent', color: sortBy === k ? '#e8edf5' : '#5c6580', border: 'none', cursor: 'pointer', fontSize: 10 }}>
                {k}
              </button>
            ))}
          </div>
          <button onClick={onCreate} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, fontSize: 11, background: '#e8edf5', color: '#07080b', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            + Project
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, color: '#5c6580', fontSize: 12 }}>Loading workspace projects...</div>
        ) : projects.length === 0 ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#5c6580', fontSize: 12 }}>No projects yet. Create the first project to begin tracking work.</div>
        ) : view === 'table' ? <ProjectTable sorted={sorted} onOpen={onOpen} /> : <ProjectMap projects={sorted} onOpen={onOpen} modeColor={modeColor} />}
      </div>
    </div>
  );
}

function ProjectTable({ sorted, onOpen }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0b0d11' }}>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {['Project','Status','Progress','Open Tasks','Blocked','Team','Due','Created'].map(h => (
              <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontWeight: 400 }}><Lbl>{h}</Lbl></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} onClick={() => onOpen(p.id)} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={{ padding: '14px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 3, height: 36, borderRadius: 99, background: p.blockers ? 'oklch(0.66 0.22 25)' : 'oklch(0.78 0.13 162)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, color: '#e8edf5', lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#2d3548', marginTop: 2 }}>{p.code}</div>
                  </div>
                </div>
              </td>
              <td style={{ padding: '14px 20px' }}>
                <span style={{ padding: '4px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#1e2430', color: '#9ba5b7' }}>{p.phase}</span>
              </td>
              <td style={{ padding: '14px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <SlimBar value={p.progress} color="oklch(0.78 0.13 162)" w={68} h={4} />
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#9ba5b7', width: 32, textAlign: 'right' }}>{Math.round(p.progress * 100)}%</span>
                </div>
              </td>
              <td style={{ padding: '14px 20px', fontSize: 11, fontFamily: 'monospace', color: '#9ba5b7' }}>{p.activeTasks}</td>
              <td style={{ padding: '14px 20px', fontSize: 11, fontFamily: 'monospace', color: p.blockers > 0 ? 'oklch(0.75 0.15 45)' : '#1a2035' }}>
                {p.blockers > 0 ? p.blockers : '--'}
              </td>
              <td style={{ padding: '14px 20px' }}><AvatarStack ids={p.team} size={22} max={4} /></td>
              <td style={{ padding: '14px 20px', fontSize: 11, fontFamily: 'monospace', color: p.daysLeft !== null && p.daysLeft < 7 ? 'oklch(0.75 0.15 45)' : '#5c6580' }}>{p.daysLeft === null ? '--' : `${p.daysLeft}d`}</td>
              <td style={{ padding: '14px 20px', fontSize: 10, fontFamily: 'monospace', color: '#2d3548' }}>{p.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectMap({ projects, onOpen, modeColor }) {
  const W = 860, H = 440, PAD = 60;
  const pos = useMemo(() => {
    const m = {};
    projects.forEach((p, index) => {
      const px = (index % 3) / 2;
      const seed = (p.id.charCodeAt(0) + p.id.charCodeAt(1)) % 7;
      m[p.id] = { x: PAD + (px + (seed - 3) * 0.025) * (W - 2 * PAD), y: PAD + (1 - p.progress) * (H - 2 * PAD) };
    });
    return m;
  }, []);
  const [hovered, setHovered] = useState(null);

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {[0.25, 0.5, 0.75].map(y => (
          <line key={y} x1={PAD} x2={W - PAD} y1={PAD + y * (H - 2*PAD)} y2={PAD + y * (H - 2*PAD)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" strokeDasharray="2 4" />
        ))}
        <text x={PAD} y={H - 22} fill="#2d3548" fontSize="9" fontFamily="Geist Mono" letterSpacing="2">WORKSTREAM A</text>
        <text x={W / 2} y={H - 22} fill="#2d3548" fontSize="9" fontFamily="Geist Mono" letterSpacing="2" textAnchor="middle">WORKSTREAM B</text>
        <text x={W - PAD} y={H - 22} fill="#2d3548" fontSize="9" fontFamily="Geist Mono" letterSpacing="2" textAnchor="end">WORKSTREAM C</text>
        <text x={22} y={PAD - 12} fill="#2d3548" fontSize="9" fontFamily="Geist Mono" letterSpacing="2">DONE</text>
        <text x={22} y={H - PAD + 22} fill="#2d3548" fontSize="9" fontFamily="Geist Mono" letterSpacing="2">NEW</text>
        {projects.map(p => {
          const { x, y } = pos[p.id];
          const r = 9 + Math.min(p.activeTasks, 20);
          const c = p.blockers ? 'oklch(0.66 0.22 25)' : modeColor;
          const isH = hovered === p.id;
          return (
            <g key={p.id} style={{ cursor: 'pointer' }} onMouseEnter={() => setHovered(p.id)} onMouseLeave={() => setHovered(null)} onClick={() => onOpen(p.id)}>
              {p.blockers > 0 && <circle cx={x} cy={y} r={r + 10} fill={c} opacity="0.1" />}
              <circle cx={x} cy={y} r={r} fill={c} fillOpacity={isH ? 0.35 : 0.18} stroke={c} strokeWidth={isH ? 1.5 : 1} />
              <circle cx={x} cy={y} r={3} fill={c} />
              <text x={x + r + 10} y={y + 3} fill={isH ? '#e8edf5' : '#9ba5b7'} fontSize="11" fontFamily="Geist">
                {p.code}
              </text>
              <text x={x + r + 10} y={y + 16} fill="#2d3548" fontSize="9" fontFamily="Geist Mono">
                {Math.round(p.progress * 100)}% · {p.activeTasks} open
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Cognition Rail ────────────────────────────────────────────────────────────
function CognitionRail({ onOpen, modeColor }) {
  const briefings = useMemo(() => {
    const out = [];
    PROJECTS.forEach(p => p.insights.forEach(ins => out.push({ ...ins, projectId: p.id, projectCode: p.code })));
    const rank = { risk: 0, pivot: 1, fatigue: 2, accel: 3, pattern: 4 };
    out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || (b.conf - a.conf));
    return out.slice(0, 7);
  }, []);

  const kindMeta = {
    risk:    { label: 'RISK',    color: 'oklch(0.68 0.22 25)'  },
    pivot:   { label: 'PIVOT',   color: 'oklch(0.84 0.14 80)'  },
    fatigue: { label: 'FATIGUE', color: 'oklch(0.75 0.15 45)'  },
    accel:   { label: 'ACCEL',   color: 'oklch(0.78 0.13 162)' },
    pattern: { label: 'PATTERN', color: 'oklch(0.83 0.10 220)' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: `color-mix(in oklab, ${modeColor} 20%, transparent)`, border: `1px solid color-mix(in oklab, ${modeColor} 40%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✦</div>
          <Lbl color={modeColor}>Cognition</Lbl>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 18, color: '#e8edf5' }}>{ORG_PULSE.briefingsToday}</span>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#2d3548' }}>today</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: modeColor }} />
            <Lbl color="#5c6580">Daily synthesis</Lbl>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#2d3548' }}>· 14:42</span>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: '#9ba5b7', margin: 0 }}>
            Beacon converging ahead of plan. Atlas momentum stable but bottlenecked on legal review.{' '}
            <span style={{ color: 'oklch(0.68 0.22 25)' }}>Vega requires intervention</span>{' '}
            — recommend a descope sync this week.
          </p>
        </div>

        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {briefings.map((b, i) => {
            const meta = kindMeta[b.kind];
            const isRisk = b.kind === 'risk';
            return (
              <button key={i} onClick={() => onOpen(b.projectId)}
                style={{ width: '100%', textAlign: 'left', padding: 12, borderRadius: 8, background: isRisk ? 'rgba(239,68,68,0.04)' : '#111418', border: `1px solid ${isRisk ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = isRisk ? 'rgba(239,68,68,0.07)' : '#161b22'}
                onMouseLeave={e => e.currentTarget.style.background = isRisk ? 'rgba(239,68,68,0.04)' : '#111418'}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em', background: `color-mix(in oklab, ${meta.color} 18%, transparent)`, color: meta.color }}>{meta.label}</span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#2d3548' }}>{b.projectCode}</span>
                  </div>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#2d3548' }}>{Math.round(b.conf * 100)}%</span>
                </div>
                <p style={{ fontSize: 11, lineHeight: 1.5, color: '#9ba5b7', margin: 0 }}>{b.text}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Project View ──────────────────────────────────────────────────────────────

function AccordionCard({ id, title, count, suffix, action, openId, setOpenId, children }) {
  const open = openId === id;
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)', flex: open ? '1 1 0' : '0 0 auto', minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex 0.3s ease-out' }}>
      <button onClick={() => setOpenId(open ? null : id)} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, width: '100%', textAlign: 'left' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 18, lineHeight: 1, color: '#e8edf5' }}>{title}</span>
          {count !== undefined && <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ba5b7' }}>· {count}</span>}
          {suffix && <span style={{ fontSize: 11, color: '#5c6580', marginLeft: 4 }}>{suffix}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {action}
          <span style={{ fontSize: 9, color: '#5c6580', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s' }}>&#9654;</span>
        </div>
      </button>
      <div style={{ flex: open ? '1 1 0' : '0 0 0px', opacity: open ? 1 : 0, borderTop: open ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'flex 0.3s ease-out, opacity 0.3s' }}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function MomentumChart({ data }) {
  const W = 240, H = 80;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const c = 'oklch(0.78 0.13 162)';
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - ((v - min) / range) * (H - 8) - 4]);
  const linePath = `M${pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`;
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="momg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.32" /><stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#momg2)" />
      <path d={linePath} stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill={c} />
      <circle cx={lx} cy={ly} r="7" fill={c} opacity="0.22" />
    </svg>
  );
}

function ProjectLeftRail({ project, onAssign, onCreateTask, onAddMember, onOpenTask, onOpenAllTasks, onOpenMessage, canManage, modeColor }) {
  const team = project.team || [];
  const [openId, setOpenId] = useState('momentum');
  const activeTasks = useMemo(() => project.tasks.filter(t => t.status !== 'done' && t.status !== 'review'), [project.tasks]);
  const reviewTasks = useMemo(() => project.tasks.filter(t => t.status === 'review'), [project.tasks]);
  const activityEvents = useMemo(() => {
    const ledger = (project.activity || []).map(row => ({
      at: row.created_at,
      label: String(row.action || '').replace(/^project\./, '').replace(/_/g, ' '),
      detail: row.summary || row.target_id || '',
    }));
    if (ledger.length) return ledger.slice(0, 12);
    const rows = [];
    if (project.created_at) rows.push({ at: project.created_at, label: 'Project created', detail: project.name });
    (project.team || []).forEach(m => rows.push({ at: m.joined_at || project.created_at || Date.now(), label: `${m.role || 'member'} joined`, detail: m.name }));
    (project.tasks || []).forEach(t => rows.push({ at: t.updated_at || t.created_at || Date.now(), label: t.status === 'done' ? 'Task completed' : 'Task tracked', detail: t.title }));
    return rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 12);
  }, [project]);
  const decisions = useMemo(() => {
    return (project.activity || [])
      .filter(row => row.action === 'project.decision_pinned')
      .slice(0, 10);
  }, [project.activity]);
  const memberActivity = useMemo(() => {
    const map = new Map();
    (project.activity || []).forEach(row => {
      const key = row.actor_id || row.actor_name;
      if (!key || map.has(key)) return;
      map.set(key, row);
    });
    return map;
  }, [project.activity]);
  const statusC = { todo: '#5c6580', in_progress: 'oklch(0.84 0.14 80)', review: 'oklch(0.83 0.10 220)', blocked: 'oklch(0.66 0.22 25)' };
  const statusL = { todo: 'TODO', in_progress: 'ACTIVE', review: 'REVIEW', blocked: 'BLOCKED' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
      <AccordionCard id="team" title="Team" count={team.length} openId={openId} setOpenId={setOpenId}
        action={openId === 'team' && canManage ? <span onClick={e => { e.stopPropagation(); onAddMember && onAddMember(); }} style={{ fontFamily: 'monospace', fontSize: 10, color: modeColor, letterSpacing: '0.08em', cursor: 'pointer' }}>+ ADD</span> : null}>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {team.length === 0 && <div style={{ color: '#5c6580', fontSize: 11, padding: '6px 0' }}>No project members yet.</div>}
          {team.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PersonAvatar person={p} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#e8edf5' }}>{p.name}</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#2d3548' }}>
                  {p.role}{memberActivity.get(p.id)?.action ? ` · ${String(memberActivity.get(p.id).action).replace(/^project\./, '').replace(/_/g, ' ')}` : ''}
                </div>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{p.role}</span>
            </div>
          ))}
        </div>
      </AccordionCard>

      <AccordionCard id="momentum" title="Progress" count={project.completedTasks} suffix="Completed" openId={openId} setOpenId={setOpenId}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ marginTop: 12 }}><SlimBar value={project.progress} color="oklch(0.78 0.13 162)" w={252} h={6} /></div>
          <div style={{ marginTop: 12, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div><Lbl>Done</Lbl><div style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ba5b7', marginTop: 2 }}>{project.completedTasks}</div></div>
            <div><Lbl>Open</Lbl><div style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ba5b7', marginTop: 2 }}>{project.activeTasks}</div></div>
            <div><Lbl>Blocked</Lbl><div style={{ fontFamily: 'monospace', fontSize: 12, color: project.blockers ? 'oklch(0.75 0.15 45)' : '#9ba5b7', marginTop: 2 }}>{project.blockers}</div></div>
          </div>
        </div>
      </AccordionCard>

      <AccordionCard id="tasks" title="Tasks" count={project.activeTasks} suffix="Active" openId={openId} setOpenId={setOpenId}
        action={openId === 'tasks' ? (
          <button onClick={e => { e.stopPropagation(); onOpenAllTasks && onOpenAllTasks(); }}
            style={{ fontFamily: 'monospace', fontSize: 10, color: modeColor, letterSpacing: '0.08em', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            ALL →
          </button>
        ) : null}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {canManage && <button onClick={onCreateTask} style={{ width: '100%', padding: '8px', borderRadius: 6, background: '#e8edf5', color: '#07080b', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>+ CREATE TASK</button>}
          {activeTasks.slice(0, 10).map(t => {
            const sc = statusC[t.status] || '#5c6580', sl = statusL[t.status] || t.status;
            const owner = t.assignee_id ? { id: t.assignee_id, name: t.assignee_name || t.assignee_id, handle: t.assignee_name || t.assignee_id } : null;
            return (
              <div key={t.id} onClick={() => onOpenTask && onOpenTask(t)} style={{ padding: 10, borderRadius: 8, background: '#111418', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{t.id}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.08em', background: `color-mix(in oklab, ${sc} 12%, transparent)`, color: sc }}>{sl}</span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: '#9ba5b7', marginBottom: 6 }}>{t.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {owner ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar person={owner} size={14} /><span style={{ fontFamily: 'monospace', fontSize: 9, color: '#5c6580' }}>{owner.handle}</span></div>
                         : canManage ? <button onClick={e => { e.stopPropagation(); onAssign(t); }} style={{ padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.08em', background: 'color-mix(in oklab, oklch(0.72 0.22 340) 15%, transparent)', color: 'oklch(0.72 0.22 340)', border: 'none', cursor: 'pointer' }}>ASSIGN →</button> : <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>UNASSIGNED</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{t.due_date ? new Date(Number(t.due_date)).toLocaleDateString() : '--'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </AccordionCard>

      <AccordionCard id="review" title="Review" count={reviewTasks.length} suffix="Pending" openId={openId} setOpenId={setOpenId}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reviewTasks.length === 0 && <div style={{ color: '#5c6580', fontSize: 11, padding: 10 }}>No tasks waiting for review.</div>}
          {reviewTasks.slice(0, 8).map(t => {
            const owner = t.assignee_id ? { id: t.assignee_id, name: t.assignee_name || t.assignee_id, handle: t.assignee_name || t.assignee_id } : null;
            return (
              <div key={t.id} style={{ padding: 10, borderRadius: 8, background: '#111418', border: '1px solid color-mix(in oklab, oklch(0.83 0.10 220) 22%, transparent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{t.id}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.08em', background: 'color-mix(in oklab, oklch(0.83 0.10 220) 15%, transparent)', color: 'oklch(0.83 0.10 220)' }}>REVIEW</span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: '#9ba5b7', marginBottom: 6 }}>{t.title}</div>
                {owner && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar person={owner} size={14} /><span style={{ fontFamily: 'monospace', fontSize: 9, color: '#5c6580' }}>awaiting {owner.handle}</span></div>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{t.due_date ? new Date(Number(t.due_date)).toLocaleDateString() : '--'}</span>
                </div>}
              </div>
            );
          })}
        </div>
      </AccordionCard>

      <AccordionCard id="decisions" title="Decisions" count={decisions.length} suffix="Pinned" openId={openId} setOpenId={setOpenId}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {decisions.length === 0 && <div style={{ color: '#5c6580', fontSize: 11, padding: 10 }}>No pinned decisions yet. Use DECISION on a chat message.</div>}
          {decisions.map((decision, i) => {
            const meta = decision.metadata || {};
            return (
              <div key={decision.id || i} style={{ padding: '9px 10px', borderRadius: 8, background: '#111418', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 11, color: '#d7ddea', lineHeight: 1.45 }}>{decision.summary}</div>
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: 'monospace', fontSize: 9, color: '#3b455a' }}>
                  <span>{decision.actor_name || 'Member'}</span>
                  <span>{decision.created_at ? new Date(Number(decision.created_at)).toLocaleDateString() : '--'}</span>
                </div>
                {meta.sourceMessageId && (
                  <button onClick={() => onOpenMessage?.({ messageId: meta.sourceMessageId, channelId: meta.sourceChannelId })}
                    style={{ marginTop: 7, padding: 0, background: 'none', border: 0, color: 'oklch(0.78 0.13 200)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em' }}>
                    SOURCE MESSAGE →
                  </button>
                )}
                {meta.sourceText && <div style={{ marginTop: 6, fontSize: 10, color: '#5c6580', lineHeight: 1.4, maxHeight: 42, overflow: 'hidden' }}>{meta.sourceText}</div>}
              </div>
            );
          })}
        </div>
      </AccordionCard>

      <AccordionCard id="activity" title="Activity" count={activityEvents.length} suffix="Events" openId={openId} setOpenId={setOpenId}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activityEvents.length === 0 && <div style={{ color: '#5c6580', fontSize: 11, padding: 10 }}>No project activity yet.</div>}
          {activityEvents.map((event, i) => (
            <div key={`${event.label}-${i}`} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: '#111418', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: modeColor, marginTop: 5, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#9ba5b7', textTransform: 'capitalize' }}>{event.label}</div>
                <div style={{ marginTop: 2, fontSize: 10, color: '#3b455a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </AccordionCard>
    </div>
  );
}

function ConnectedFilesPanel({ project, hdrs, onExtract, onSendToChat, canManage }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [activeBucket, setActiveBucket] = useState('All');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [intelligence, setIntelligence] = useState({});
  const [fileQuestion, setFileQuestion] = useState('');
  const [fileChat, setFileChat] = useState([]);
  const [askingFile, setAskingFile] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [briefing, setBriefing] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const d = await fetch(`/api/workspace/projects/${project.id}/files`).then(r => r.json());
      if (d.ok) {
        const nextFiles = d.files || [];
        setFiles(nextFiles);
        setSelectedFileId(prev => {
          if (prev && nextFiles.some(file => file.id === prev)) return prev;
          return nextFiles[0]?.id || null;
        });
        setIntelligence(prev => {
          const next = { ...prev };
          nextFiles.forEach(file => {
            if (file.intelligence?.lastScanAt && !next[file.id]) {
              const total = file.intelligence.totalFindings || 0;
              const critical = file.intelligence.criticalCount || 0;
              const high = file.intelligence.highCount || 0;
              next[file.id] = {
                status: 'done',
                note: `${total} finding${total === 1 ? '' : 's'} · ${critical ? `${critical} critical` : high ? `${high} high` : 'no critical'}`,
                totalFindings: total,
                criticalCount: critical,
                highCount: high,
                ledger: file.intelligence.ledger,
              };
            }
          });
          return next;
        });
      }
    } catch {
      setError('Attachment service unavailable.');
    }
  }, [project.id]);

  useEffect(() => { loadFiles(); }, [loadFiles]);
  const templateMeta = useMemo(() => {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(`axis_project_template_${project.id}`) || 'null'); } catch { return null; }
  }, [project.id]);
  const fileBuckets = useMemo(() => ['All', ...(templateMeta?.fileBuckets || ['Source Files', 'Exports', 'SOMA Briefs'])], [templateMeta]);
  const bucketForFile = file => {
    const ext = getExt(file);
    if (['xlsx', 'xls', 'csv'].includes(ext)) return fileBuckets.find(b => /budget|dataset|export|evidence/i.test(b)) || 'Exports';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return fileBuckets.find(b => /asset|final|draft/i.test(b)) || 'Source Files';
    if (['md', 'txt', 'pdf', 'docx'].includes(ext)) return fileBuckets.find(b => /paper|brief|source|reference|spec/i.test(b)) || 'Source Files';
    return 'Source Files';
  };
  const visibleFiles = useMemo(() => activeBucket === 'All' ? files : files.filter(file => bucketForFile(file) === activeBucket), [files, activeBucket, fileBuckets]);
  const selectedFile = useMemo(
    () => files.find(file => file.id === selectedFileId) || visibleFiles[0] || files[0] || null,
    [files, selectedFileId, visibleFiles]
  );

  function getExt(file) { return String(file.ext || file.originalName?.split('.').pop() || '').toLowerCase(); }
  const canExtract = file => ['xlsx', 'xls', 'csv', 'json', 'md', 'txt', 'rtf'].includes(getExt(file)) && file.path;
  const isExcel = file => ['xlsx', 'xls'].includes(getExt(file)) && file.path;
  const shortHash = value => value ? String(value).slice(0, 10) : 'unsealed';
  const indexingLabel = file => {
    const intel = file.intelligence || {};
    if (intel.indexingStatus === 'indexed' || intel.indexed) return `SEARCHABLE${intel.indexedChars ? ` · ${Math.round(intel.indexedChars / 1000)}k chars` : ''}`;
    if (intel.indexingStatus === 'failed') return `INDEX FAILED${intel.indexError ? ` · ${intel.indexError}` : ''}`;
    if (intel.indexingStatus === 'skipped') return `NOT INDEXED · ${intel.indexError || 'no readable text'}`;
    return 'INDEX PENDING';
  };
  const indexingColor = file => {
    const status = file.intelligence?.indexingStatus;
    if (status === 'indexed' || file.intelligence?.indexed) return 'oklch(0.74 0.13 162)';
    if (status === 'failed') return 'oklch(0.75 0.15 45)';
    if (status === 'skipped') return '#5c6580';
    return 'oklch(0.72 0.22 340)';
  };
  const attentionFiles = useMemo(() => files.filter(file => {
    const intel = file.intelligence || {};
    return intel.indexingStatus === 'failed' || intel.indexingStatus === 'skipped' || intel.indexingStatus === 'pending' || intel.criticalCount > 0 || intel.highCount > 0;
  }), [files]);
  const auditConfidence = selectedFile ? (() => {
    const intel = selectedFile.intelligence || {};
    let score = 35;
    if (selectedFile.checksum) score += 18;
    if (intel.indexed || intel.indexingStatus === 'indexed') score += 30;
    if (intel.lastScanAt) score += 12;
    if (intel.indexingStatus === 'failed') score -= 18;
    if (intel.criticalCount > 0) score -= 8;
    return Math.max(5, Math.min(100, score));
  })() : 0;

  const analyzeExcel = async (file) => {
    if (!isExcel(file)) return;
    setIntelligence(prev => ({ ...prev, [file.id]: { status: 'running', note: 'Analyzing workbook...' } }));
    try {
      const response = await fetch(`/api/workspace/files/${file.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preparedFor: project.name }),
      });
      const d = await response.json();
      if (!response.ok || !d.ok) throw new Error(d.error || 'Excel analysis failed');
      const findingText = `${d.totalFindings || 0} finding${Number(d.totalFindings || 0) === 1 ? '' : 's'}`;
      const riskText = d.criticalCount > 0
        ? `${d.criticalCount} critical`
        : d.highCount > 0
          ? `${d.highCount} high`
          : 'no critical';
      setIntelligence(prev => ({
        ...prev,
        [file.id]: {
          status: 'done',
          note: `${findingText} · ${riskText}`,
          totalFindings: d.totalFindings || 0,
          criticalCount: d.criticalCount || 0,
          highCount: d.highCount || 0,
          ledger: d.ledger,
        },
      }));
      await loadFiles();
    } catch (e) {
      setIntelligence(prev => ({ ...prev, [file.id]: { status: 'error', note: e.message || 'Analysis failed' } }));
    }
  };

  const uploadFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    const headers = { ...hdrs() };
    delete headers['Content-Type'];
    delete headers['content-type'];
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/files`, { method: 'POST', headers, body: form });
      const d = await response.json();
      if (!d.ok) throw new Error(d.error || 'Upload failed');
      await loadFiles();
      if (isExcel(d.file)) analyzeExcel(d.file);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const removeFile = async id => {
    await fetch(`/api/workspace/files/${id}`, { method: 'DELETE', headers: hdrs() });
    await loadFiles();
  };

  const reindexFile = async file => {
    setFiles(prev => prev.map(f => f.id === file.id ? {
      ...f,
      intelligence: { ...(f.intelligence || {}), indexingStatus: 'pending', indexError: null },
    } : f));
    try {
      const response = await fetch(`/api/workspace/files/${file.id}/index`, { method: 'POST', headers: hdrs() });
      const d = await response.json();
      if (!response.ok || !d.ok) throw new Error(d.error || 'Indexing failed');
      await loadFiles();
    } catch (e) {
      setFiles(prev => prev.map(f => f.id === file.id ? {
        ...f,
        intelligence: { ...(f.intelligence || {}), indexed: false, indexingStatus: 'failed', indexError: e.message },
      } : f));
    }
  };

  const askSelectedFile = async () => {
    const question = fileQuestion.trim();
    if (!question || askingFile) return;
    const userMessage = { id: `u-${Date.now()}`, role: 'user', text: question, time: Date.now() };
    setFileChat(prev => [...prev, userMessage]);
    setFileQuestion('');
    setAskingFile(true);
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/files/ask`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ question, selectedFileId: selectedFile?.id || null }),
      });
      const d = await response.json().catch(() => ({}));
      if (!response.ok || !d.ok) throw new Error(d.error || 'SOMA project file question failed');
      const somaMessage = {
        id: `s-${Date.now()}`,
        role: 'soma',
        text: d.answer || 'No answer returned.',
        ledger: d.ledger,
        usedFiles: (d.files || []).slice(0, 6).map(file => ({
          id: file.id,
          name: file.originalName,
          status: file.intelligence?.indexingStatus || 'unknown',
        })),
        time: Date.now(),
      };
      setFileChat(prev => [...prev, somaMessage]);
      await loadFiles();
    } catch (e) {
      setFileChat(prev => [...prev, { id: `e-${Date.now()}`, role: 'soma', text: `I could not inspect the project files yet: ${e.message}`, error: true, time: Date.now() }]);
    } finally {
      setAskingFile(false);
    }
  };

  const generateBrief = async () => {
    if (briefing) return;
    setBriefing(true);
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/brief`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({}),
      });
      const d = await response.json().catch(() => ({}));
      if (!response.ok || !d.ok) throw new Error(d.error || 'Brief failed');
      setFileChat(prev => [...prev, {
        id: `brief-${Date.now()}`,
        role: 'soma',
        text: d.brief || 'No brief returned.',
        ledger: d.ledger,
        time: Date.now(),
      }]);
      await loadFiles();
    } catch (e) {
      setFileChat(prev => [...prev, { id: `brief-error-${Date.now()}`, role: 'soma', text: `I could not generate the project brief: ${e.message}`, error: true, time: Date.now() }]);
    } finally {
      setBriefing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Lbl>Files</Lbl><span style={{ color: '#2d3548', fontSize: 10, fontFamily: 'monospace' }}>· {files.length} · project isolated</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setExportOpen(v => !v)} style={{ padding: '5px 10px', borderRadius: 6, background: 'rgba(34,197,94,0.10)', color: 'oklch(0.74 0.13 162)', border: '1px solid rgba(34,197,94,0.18)', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer' }}>EXPORTS</button>
            {exportOpen && (
              <div style={{ position: 'absolute', top: 30, right: 0, zIndex: 30, width: 220, padding: 8, borderRadius: 9, background: '#111418', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 18px 44px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <a href={`/api/workspace/projects/${project.id}/files/smart-workbook`} style={{ padding: '8px 9px', borderRadius: 6, color: 'oklch(0.74 0.13 162)', textDecoration: 'none', fontFamily: 'monospace', fontSize: 10, background: 'rgba(34,197,94,0.08)' }}>Project intelligence workbook</a>
                {selectedFile && <a href={`/api/workspace/files/${selectedFile.id}/smart-workbook`} style={{ padding: '8px 9px', borderRadius: 6, color: '#9ba5b7', textDecoration: 'none', fontFamily: 'monospace', fontSize: 10 }}>Selected file smart workbook</a>}
                {selectedFile && isExcel(selectedFile) && <a href={`/api/workspace/files/${selectedFile.id}/report`} style={{ padding: '8px 9px', borderRadius: 6, color: '#9ba5b7', textDecoration: 'none', fontFamily: 'monospace', fontSize: 10 }}>Selected HTML report</a>}
                {selectedFile && canExtract(selectedFile) && <button onClick={() => { setExportOpen(false); onExtract?.({ name: selectedFile.originalName, path: selectedFile.path, ext: getExt(selectedFile), size: selectedFile.size, modified: selectedFile.uploadedAt }); }} style={{ textAlign: 'left', padding: '8px 9px', borderRadius: 6, color: 'oklch(0.72 0.22 340)', background: 'none', border: 0, fontFamily: 'monospace', fontSize: 10, cursor: 'pointer' }}>Open extraction studio</button>}
              </div>
            )}
          </div>
          {canManage && <button disabled={uploading} onClick={() => inputRef.current?.click()} style={{ padding: '5px 10px', borderRadius: 6, background: '#e8edf5', color: '#07080b', border: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10 }}>{uploading ? 'UPLOADING...' : '+ UPLOAD'}</button>}
        </div>
        <input ref={inputRef} type="file" onChange={uploadFile} style={{ display: 'none' }} />
      </div>
      {error && <div style={{ padding: '10px 14px', color: 'oklch(0.75 0.15 45)', fontSize: 11 }}>{error}</div>}
      <div style={{ padding: '10px 14px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {fileBuckets.map(bucket => (
          <button key={bucket} onClick={() => setActiveBucket(bucket)}
            style={{ padding: '4px 8px', borderRadius: 999, border: activeBucket === bucket ? '1px solid rgba(232,237,245,0.45)' : '1px solid rgba(255,255,255,0.07)', background: activeBucket === bucket ? 'rgba(255,255,255,0.08)' : 'transparent', color: activeBucket === bucket ? '#e8edf5' : '#5c6580', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer' }}>
            {bucket}
          </button>
        ))}
      </div>
      <div style={{ margin: '9px 14px 0', padding: '7px 9px', borderRadius: 8, background: attentionFiles.length ? 'rgba(245,158,11,0.07)' : 'rgba(34,197,94,0.055)', border: attentionFiles.length ? '1px solid rgba(245,158,11,0.18)' : '1px solid rgba(34,197,94,0.12)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <span style={{ color: attentionFiles.length ? 'oklch(0.80 0.12 80)' : 'oklch(0.74 0.13 162)', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em' }}>
          REVIEW QUEUE · {attentionFiles.length} FILE{attentionFiles.length === 1 ? '' : 'S'}
        </span>
        <span style={{ color: '#5c6580', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {attentionFiles[0] ? `${attentionFiles[0].originalName} needs attention` : 'Files are clean or waiting for new uploads'}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(110px, 0.42fr) minmax(300px, 1fr)', gap: 10, padding: 14 }}>
        <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
          {visibleFiles.length === 0 ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 32, color: '#5c6580', fontSize: 12, textAlign: 'center' }}>
              {files.length === 0 ? `Upload source files, references, or deliverables for ${project.name}.` : `No files in ${activeBucket}.`}
            </div>
          ) : visibleFiles.map(file => {
            const active = selectedFile?.id === file.id;
            return (
              <button key={file.id} onClick={() => setSelectedFileId(file.id)} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', marginBottom: 6, borderRadius: 8, background: active ? 'rgba(167,139,250,0.08)' : '#111418', border: active ? '1px solid rgba(167,139,250,0.28)' : '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ width: 22, height: 28, borderRadius: 4, display: 'grid', placeItems: 'center', background: (FILE_ICON[getExt(file)] || { color: '#3f4a5c' }).color, color: '#050608', fontFamily: 'monospace', fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                  {(FILE_ICON[getExt(file)] || { text: getExt(file).slice(0, 2).toUpperCase() || '?' }).text}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e8edf5', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.originalName}</div>
                  <div style={{ marginTop: 2, color: '#5c6580', fontSize: 9, fontFamily: 'monospace' }}>
                    v{file.version || 1} · {Math.max(1, Math.round(Number(file.size || 0) / 1024))} KB · sha256:{shortHash(file.checksum)}
                  </div>
                  <div style={{ marginTop: 3, color: indexingColor(file), fontSize: 8.5, fontFamily: 'monospace', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    SEARCH · {indexingLabel(file)}
                  </div>
                  {intelligence[file.id]?.note && (
                    <div style={{
                      marginTop: 3,
                      color: intelligence[file.id].status === 'error' ? 'oklch(0.75 0.15 45)' : intelligence[file.id].criticalCount ? 'oklch(0.75 0.18 35)' : 'oklch(0.74 0.13 162)',
                      fontSize: 8.5,
                      fontFamily: 'monospace',
                      letterSpacing: '0.04em',
                    }}>
                      INTEL · {intelligence[file.id].note}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: selectedFile ? 'auto auto 1fr auto' : 'auto 1fr auto', borderRadius: 10, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          {selectedFile && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#e8edf5', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile.originalName}</div>
                  <div style={{ marginTop: 4, color: '#5c6580', fontSize: 9, fontFamily: 'monospace', lineHeight: 1.55 }}>
                    uploaded {new Date(selectedFile.uploadedAt).toLocaleString()} · {fmtSize(Number(selectedFile.size || 0))} · {getExt(selectedFile).toUpperCase() || 'FILE'}
                  </div>
                  <div style={{ marginTop: 3, color: indexingColor(selectedFile), fontSize: 9, fontFamily: 'monospace' }}>
                    {indexingLabel(selectedFile)}
                    {selectedFile.intelligence?.documentId ? ` · ${selectedFile.intelligence.documentId}` : ''}
                  </div>
                  <div style={{ marginTop: 7, width: 170 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 8.5, color: '#3b455a', marginBottom: 3 }}>
                      <span>AUDIT CONFIDENCE</span><span>{auditConfidence}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${auditConfidence}%`, height: '100%', borderRadius: 99, background: auditConfidence > 74 ? 'oklch(0.74 0.13 162)' : auditConfidence > 49 ? 'oklch(0.80 0.12 80)' : 'oklch(0.75 0.15 45)' }} />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7, flexShrink: 0 }}>
                  <a href={`/api/workspace/files/${selectedFile.id}/download`} style={{ color: '#9ba5b7', fontSize: 10, fontFamily: 'monospace', textDecoration: 'none' }}>OPEN</a>
                  <button onClick={() => onSendToChat?.(selectedFile)} style={{ color: 'oklch(0.78 0.13 200)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>SEND TO CHAT</button>
                  <a href={`/api/workspace/files/${selectedFile.id}/smart-workbook`} style={{ color: 'oklch(0.74 0.13 162)', fontSize: 10, fontFamily: 'monospace', textDecoration: 'none' }}>SMART XLSX</a>
                  {isExcel(selectedFile) && <a href={`/api/workspace/files/${selectedFile.id}/report`} style={{ color: '#9ba5b7', fontSize: 10, fontFamily: 'monospace', textDecoration: 'none' }}>HTML REPORT</a>}
                  {selectedFile.intelligence?.indexingStatus !== 'indexed' && (
                    <button onClick={() => reindexFile(selectedFile)} style={{ color: '#9ba5b7', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>INDEX</button>
                  )}
                  {isExcel(selectedFile) && (
                    <button onClick={() => analyzeExcel(selectedFile)} disabled={intelligence[selectedFile.id]?.status === 'running'} style={{ color: '#9ba5b7', background: 'none', border: 'none', cursor: intelligence[selectedFile.id]?.status === 'running' ? 'default' : 'pointer', fontSize: 10, fontFamily: 'monospace', opacity: intelligence[selectedFile.id]?.status === 'running' ? 0.5 : 1 }}>
                      {intelligence[selectedFile.id]?.status === 'running' ? 'SCAN...' : 'EXCEL INTEL'}
                    </button>
                  )}
                  {canExtract(selectedFile) && (
                    <button onClick={() => onExtract?.({ name: selectedFile.originalName, path: selectedFile.path, ext: getExt(selectedFile), size: selectedFile.size, modified: selectedFile.uploadedAt })} style={{ color: 'oklch(0.72 0.22 340)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>EXTRACT</button>
                  )}
                  {canManage && <button onClick={() => removeFile(selectedFile.id)} style={{ color: '#5c6580', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>DELETE</button>}
                </div>
              </div>
            </div>
          )}

            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'rgba(167,139,250,0.035)' }}>
              <div style={{ minWidth: 0 }}>
                <Lbl color="oklch(0.72 0.22 340)">Mini File Intelligence</Lbl>
                <div style={{ marginTop: 3, color: '#5c6580', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Ask SOMA about this project&apos;s uploaded files. Select a file to focus the answer.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button onClick={generateBrief} disabled={briefing} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(167,139,250,0.07)', color: briefing ? '#5c6580' : '#c4b5fd', cursor: briefing ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em' }}>{briefing ? 'BRIEF...' : 'SOMA BRIEF'}</button>
                <span style={{ color: selectedFile ? indexingColor(selectedFile) : '#5c6580', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                  {selectedFile ? `FOCUS · ${selectedFile.originalName}` : `${files.length} FILE${files.length === 1 ? '' : 'S'}`}
                </span>
              </div>
            </div>

            <div style={{ minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fileChat.length === 0 ? (
                <div style={{ display: 'grid', placeItems: 'center', minHeight: 132, color: '#5c6580', fontSize: 11, textAlign: 'center', lineHeight: 1.55, border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 9, background: 'rgba(255,255,255,0.015)', padding: 16 }}>
                  <div>
                    <div style={{ color: '#c4b5fd', fontSize: 12, marginBottom: 6 }}>Ask SOMA about the project files.</div>
                    Try: summarize all uploads, compare two files, find variance, extract action items, identify missing data, explain clauses, or prepare an Excel export.
                  </div>
                </div>
              ) : fileChat.map(msg => (
                <div key={msg.id} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', padding: '8px 10px', borderRadius: msg.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px', background: msg.role === 'user' ? 'rgba(232,237,245,0.10)' : 'rgba(167,139,250,0.08)', border: msg.error ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(255,255,255,0.07)', color: msg.error ? 'oklch(0.75 0.15 45)' : msg.role === 'user' ? '#e8edf5' : '#c4b5fd', fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                  {msg.ledger?.hash && <div style={{ marginTop: 6, color: '#5c6580', fontSize: 9, fontFamily: 'monospace' }}>ledger:{shortHash(msg.ledger.hash)}</div>}
                  {msg.usedFiles?.length > 0 && (
                    <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {msg.usedFiles.map(file => (
                        <span key={file.id} style={{ padding: '2px 6px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ba5b7', fontFamily: 'monospace', fontSize: 8.5 }}>
                          {file.name} · {file.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', gap: 7, padding: '6px 9px', borderRadius: 7, background: '#111418', border: '1px solid rgba(255,255,255,0.07)' }}>
                <input value={fileQuestion} onChange={e => setFileQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) askSelectedFile(); }} placeholder={selectedFile ? `Ask about ${selectedFile.originalName}, or all project files...` : 'Ask SOMA about uploaded project files...'} style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: '#e8edf5', fontSize: 11 }} />
                <button onClick={askSelectedFile} disabled={!fileQuestion.trim() || askingFile} style={{ color: askingFile ? '#2d3548' : 'oklch(0.72 0.22 340)', background: 'none', border: 0, cursor: askingFile ? 'default' : 'pointer', fontSize: 13 }}>{askingFile ? '...' : 'ASK'}</button>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

const TEXT_EXTS  = new Set(['md','txt','rtf','js','ts','jsx','tsx','py','json','yaml','yml','sql','sh','bat','css','html','log','csv','ini','toml','cfg','env','gitignore']);
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','svg']);

function FileWorkspace({ project, pendingFile, setPendingFile, onExtract, modeColor }) {
  const storageKey = `axis_fs_root_${project.id}`;
  const [rootPath,    setRootPath]    = useState(() => localStorage.getItem(storageKey) || '');
  const [rootInput,   setRootInput]   = useState(() => localStorage.getItem(storageKey) || '');
  const [editingRoot, setEditingRoot] = useState(() => !localStorage.getItem(storageKey));
  const [dirCache,    setDirCache]    = useState({});
  const [expanded,    setExpanded]    = useState(new Set());
  const [loadingDirs, setLoadingDirs] = useState(new Set());
  const [selected,    setSelected]    = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState(null);
  const [searching,   setSearching]   = useState(false);
  const [fileMsg,     setFileMsg]     = useState('');
  const [somaReply,   setSomaReply]   = useState(null);
  const [askBusy,     setAskBusy]     = useState(false);
  const searchTimer = useRef(null);

  const browseDir = useCallback(async (dirPath) => {
    if (dirCache[dirPath]) return dirCache[dirPath];
    setLoadingDirs(prev => new Set(prev).add(dirPath));
    try {
      const r = await fetch(`/api/conceive/fs/browse?path=${encodeURIComponent(dirPath)}`);
      const d = await r.json();
      if (d.success) {
        setDirCache(prev => ({ ...prev, [dirPath]: d.items || [] }));
        return d.items || [];
      }
    } catch {} finally {
      setLoadingDirs(prev => { const s = new Set(prev); s.delete(dirPath); return s; });
    }
    return [];
  }, [dirCache]);

  useEffect(() => { if (rootPath) browseDir(rootPath); }, [rootPath]); // eslint-disable-line

  const applyRoot = (p) => {
    const v = p.trim();
    if (!v) return;
    localStorage.setItem(storageKey, v);
    setRootPath(v);
    setRootInput(v);
    setEditingRoot(false);
    setDirCache({});
    setExpanded(new Set());
    setSelected(null);
    setFileContent(null);
    setSearchQ('');
    setSearchRes(null);
  };

  const toggleDir = async (item) => {
    const next = new Set(expanded);
    if (next.has(item.path)) { next.delete(item.path); }
    else { next.add(item.path); if (!dirCache[item.path]) await browseDir(item.path); }
    setExpanded(next);
  };

  const selectFile = async (item) => {
    setSelected(item);
    setFileContent(null);
    setSomaReply(null);
    const isTextFile = TEXT_EXTS.has(item.ext);
    if (!isTextFile) return;
    setLoadingFile(true);
    try {
      const r = await fetch('/api/soma/fs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      const d = await r.json();
      setFileContent(d.success ? (d.content ?? '') : null);
    } catch { setFileContent(null); }
    finally { setLoadingFile(false); }
  };

  const handleSearch = (q) => {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchRes(null); return; }
    searchTimer.current = setTimeout(async () => {
      if (!rootPath) return;
      setSearching(true);
      try {
        const r = await fetch(`/api/conceive/fs/search?root=${encodeURIComponent(rootPath)}&query=${encodeURIComponent(q)}`);
        const d = await r.json();
        setSearchRes(d.success ? (d.results || []) : []);
      } catch { setSearchRes([]); }
      finally { setSearching(false); }
    }, 320);
  };

  const askSoma = async () => {
    if (!fileMsg.trim() || !selected || askBusy) return;
    setAskBusy(true);
    setSomaReply(null);
    try {
      const ctx = fileContent ? `\n\nFile: ${selected.name}\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\`` : '';
      const r = await fetch('/api/soma/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `${fileMsg}${ctx}`, conversationHistory: [] }),
      });
      const d = await r.json();
      setSomaReply(d.response || d.message || 'No response.');
      setFileMsg('');
    } catch { setSomaReply('Could not reach SOMA.'); }
    finally { setAskBusy(false); }
  };

  const fileUrl = (p) => `/api/conceive/fs/file?path=${encodeURIComponent(p)}`;

  const renderTree = (items, depth = 0) => items.map(item => {
    const isDir  = item.type === 'directory';
    const isOpen = expanded.has(item.path);
    const isSel  = selected?.path === item.path;
    const fic    = !isDir ? (FILE_ICON[item.ext] || { color: '#3f4a5c', text: (item.ext || '?').slice(0,2).toUpperCase() }) : null;
    const childLoading = isDir && isOpen && loadingDirs.has(item.path);
    const children = dirCache[item.path] || [];

    return (
      <div key={item.path}>
        <button
          onClick={() => isDir ? toggleDir(item) : selectFile(item)}
          style={{ width: '100%', paddingLeft: 8 + depth * 12, paddingRight: 8, paddingTop: 3, paddingBottom: 3, display: 'flex', alignItems: 'center', gap: 5, background: isSel ? 'rgba(255,255,255,0.05)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
          onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'none'; }}
        >
          {isDir ? (
            <>
              <span style={{ fontSize: 7, color: '#2d3548', flexShrink: 0, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>▶</span>
              <span style={{ fontSize: 12, flexShrink: 0, lineHeight: 1 }}>📁</span>
            </>
          ) : (
            <>
              <span style={{ width: 7, flexShrink: 0 }} />
              <div style={{ width: 14, height: 18, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontFamily: 'monospace', background: fic.color, color: '#000', flexShrink: 0, letterSpacing: 0 }}>{fic.text}</div>
            </>
          )}
          <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSel ? '#e8edf5' : isDir ? '#9ba5b7' : '#7a8599' }}>{item.name}</span>
          {!isDir && item.size > 0 && <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#2d3548', flexShrink: 0 }}>{fmtSize(item.size)}</span>}
        </button>
        {isDir && isOpen && (
          childLoading
            ? <div style={{ paddingLeft: 28 + depth * 12, fontSize: 9, color: '#2d3548', fontFamily: 'monospace', paddingTop: 2 }}>loading…</div>
            : children.length === 0
              ? <div style={{ paddingLeft: 28 + depth * 12, fontSize: 9, color: '#2d3548', fontFamily: 'monospace', paddingTop: 2 }}>empty</div>
              : renderTree(children, depth + 1)
        )}
      </div>
    );
  });

  const isImage = selected && IMAGE_EXTS.has(selected.ext);
  const isText  = selected && TEXT_EXTS.has(selected.ext);
  const isPdf   = selected?.ext === 'pdf';
  const selFic  = selected ? (FILE_ICON[selected.ext] || { color: '#3f4a5c', text: (selected.ext || '?').slice(0,2).toUpperCase() }) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Lbl>Files</Lbl>
          {rootPath && !editingRoot && (
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }} title={rootPath}>
              {rootPath.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {selected && !editingRoot && (
            <>
              <button onClick={() => onExtract(selected)} style={{ padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: 9, background: 'rgba(220,100,100,0.1)', border: '1px solid rgba(220,100,100,0.25)', color: 'oklch(0.72 0.22 340)', cursor: 'pointer' }}>EXTRACT</button>
              <button onClick={() => setPendingFile(selected)} style={{ padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: 9, background: '#161b22', border: '1px solid rgba(255,255,255,0.07)', color: '#9ba5b7', cursor: 'pointer' }}>LINK</button>
            </>
          )}
          <button onClick={() => { setEditingRoot(v => !v); setRootInput(rootPath); }} title="Set root folder"
            style={{ padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: 9, background: editingRoot ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${editingRoot ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.07)'}`, color: editingRoot ? '#c4b5fd' : '#5c6580', cursor: 'pointer' }}>
            {editingRoot ? '✕' : '⊕ PATH'}
          </button>
        </div>
      </div>

      {/* Root path editor */}
      {editingRoot && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, background: 'rgba(167,139,250,0.04)' }}>
          <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#5c6580', marginBottom: 5, letterSpacing: '0.1em' }}>ROOT DIRECTORY</div>
          <div style={{ display: 'flex', gap: 5 }}>
            <input value={rootInput} onChange={e => setRootInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyRoot(rootInput); if (e.key === 'Escape') setEditingRoot(false); }}
              placeholder="e.g. C:\Users\YOUR_USER\Documents"
              autoFocus
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, padding: '5px 9px', fontSize: 11, color: '#e8edf5', outline: 'none', fontFamily: 'monospace' }}
            />
            <button onClick={() => applyRoot(rootInput)} style={{ padding: '5px 12px', borderRadius: 5, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600 }}>GO</button>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

        {/* Tree column */}
        <div style={{ width: 192, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          {rootPath && (
            <div style={{ padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '3px 7px' }}>
                <span style={{ fontSize: 9, color: '#2d3548' }}>⌕</span>
                <input value={searchQ} onChange={e => handleSearch(e.target.value)}
                  placeholder="Search files…"
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 10, color: '#9ba5b7', fontFamily: 'inherit' }}
                />
                {searching && <span style={{ fontSize: 9, color: '#2d3548', fontFamily: 'monospace' }}>…</span>}
                {searchQ && !searching && <button onClick={() => { setSearchQ(''); setSearchRes(null); }} style={{ background: 'none', border: 'none', color: '#2d3548', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>}
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
            {!rootPath ? (
              <div style={{ padding: '24px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#2d3548', fontFamily: 'monospace', marginBottom: 6 }}>No folder linked</div>
                <button onClick={() => setEditingRoot(true)} style={{ padding: '4px 12px', borderRadius: 5, fontFamily: 'monospace', fontSize: 9, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', color: '#9ba5b7', cursor: 'pointer' }}>⊕ Link folder</button>
              </div>
            ) : loadingDirs.has(rootPath) ? (
              <div style={{ padding: 12, fontSize: 10, color: '#2d3548', fontFamily: 'monospace', textAlign: 'center' }}>loading…</div>
            ) : searchRes !== null ? (
              searchRes.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 10, color: '#2d3548', fontFamily: 'monospace' }}>No results</div>
              ) : searchRes.map(r => {
                const ext = r.name.split('.').pop()?.toLowerCase() || '';
                const fic = FILE_ICON[ext] || { color: '#3f4a5c', text: ext.slice(0,2).toUpperCase() || '?' };
                return (
                  <button key={r.path} onClick={() => selectFile({ ...r, ext, type: 'file' })}
                    style={{ width: '100%', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5, background: selected?.path === r.path ? 'rgba(255,255,255,0.05)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                    onMouseLeave={e => { if (selected?.path !== r.path) e.currentTarget.style.background = 'none'; }}>
                    <div style={{ width: 13, height: 17, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontFamily: 'monospace', background: fic.color, color: '#000', flexShrink: 0 }}>{fic.text}</div>
                    <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ba5b7' }}>{r.name}</span>
                  </button>
                );
              })
            ) : (
              renderTree(dirCache[rootPath] || [])
            )}
          </div>
        </div>

        {/* Viewer + file chat */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <>
              {/* File header */}
              <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                <div style={{ width: 20, height: 26, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 9, background: selFic.color, color: '#000', flexShrink: 0 }}>{selFic.text}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#e8edf5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548', marginTop: 1 }}>
                    {fmtSize(selected.size)}{selected.modified ? ` · ${new Date(selected.modified).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {(isPdf || isImage) && (
                  <a href={fileUrl(selected.path)} target="_blank" rel="noreferrer"
                    style={{ padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ba5b7', textDecoration: 'none', flexShrink: 0 }}>
                    OPEN ↗
                  </a>
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {loadingFile ? (
                  <div style={{ padding: 20, fontSize: 10, color: '#2d3548', fontFamily: 'monospace', textAlign: 'center' }}>loading…</div>
                ) : isImage ? (
                  <div style={{ padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                    <img src={fileUrl(selected.path)} alt={selected.name} style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', objectFit: 'contain' }} />
                  </div>
                ) : isPdf ? (
                  <div style={{ padding: 16, height: '92%', minHeight: 200 }}>
                    <iframe src={fileUrl(selected.path)} title={selected.name} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 6 }} />
                  </div>
                ) : isText && fileContent !== null ? (
                  <div style={{ padding: '12px 16px' }}>
                    {selected.ext === 'md' ? (
                      <div style={{ fontSize: 12, lineHeight: 1.75, color: '#9ba5b7', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fileContent}</div>
                    ) : (
                      <pre style={{ fontSize: 10.5, lineHeight: 1.65, color: '#9ba5b7', fontFamily: "'Geist Mono', 'Courier New', monospace", margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'break-word' }}>{fileContent}</pre>
                    )}
                  </div>
                ) : (
                  <div style={{ margin: 14, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111418', border: '1px dashed rgba(255,255,255,0.07)', minHeight: 120 }}>
                    <div style={{ textAlign: 'center', padding: 20 }}>
                      <div style={{ width: 36, height: 44, margin: '0 auto', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 12, background: selFic.color, color: '#000' }}>{selFic.text}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: '#5c6580' }}>{selected.name}</div>
                      <a href={fileUrl(selected.path)} target="_blank" rel="noreferrer"
                        style={{ display: 'inline-block', marginTop: 8, padding: '4px 12px', borderRadius: 5, fontFamily: 'monospace', fontSize: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ba5b7', textDecoration: 'none' }}>
                        OPEN ↗
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* SOMA file chat */}
              <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.008)' }}>
                <div style={{ padding: '5px 14px 3px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Lbl>Ask SOMA</Lbl>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>file context · in memory</span>
                </div>
                {somaReply && (
                  <div style={{ margin: '0 10px 5px', padding: '6px 10px', borderRadius: 7, background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.15)', fontSize: 11, color: '#c4b5fd', lineHeight: 1.55, maxHeight: 72, overflowY: 'auto' }}>
                    {somaReply}
                  </div>
                )}
                <div style={{ padding: '0 10px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, background: '#111418', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <input value={fileMsg} onChange={e => setFileMsg(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) askSoma(); }}
                      placeholder={`Ask about ${selected.name}…`}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 11, color: '#e8edf5', fontFamily: 'inherit' }}
                    />
                    <button onClick={askSoma} disabled={askBusy || !fileMsg.trim()} style={{ color: askBusy ? '#2d3548' : (modeColor || '#c4b5fd'), background: 'none', border: 'none', cursor: askBusy ? 'default' : 'pointer', fontSize: 14, transition: 'color 0.15s' }}>
                      {askBusy ? '…' : '↗'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontSize: 10, color: '#2d3548', fontFamily: 'monospace' }}>{rootPath ? 'Select a file to preview' : 'Link a folder to get started'}</div>
              {!rootPath && (
                <button onClick={() => setEditingRoot(true)} style={{ padding: '5px 14px', borderRadius: 5, fontFamily: 'monospace', fontSize: 10, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', color: '#9ba5b7', cursor: 'pointer' }}>⊕ Link folder</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ msg, currentUserId, project, onOpenChannel, onOpenTask, onMakeTask, onPinDecision, highlighted = false }) {
  const senderId = msg.sender_id || msg.sender;
  const senderName = msg.sender_name || msg.senderName || senderId || 'Member';
  const isSoma = senderId === 'soma' || msg.is_soma;
  const person = isSoma ? null : { id: senderId, name: senderName };
  const bc = isSoma ? BUBBLE_COLOR.axis : (BUBBLE_COLOR[senderId] || { bg: 'oklch(0.30 0.04 280)', tx: '#fff' });
  const isRight = senderId === currentUserId;
  const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (msg.time || '');
  const sharedFile = parseSharedFileMessage(msg.content || msg.text);
  return (
    <div data-message-id={msg.id} style={{ display: 'flex', gap: 8, flexDirection: isRight ? 'row-reverse' : 'row', padding: highlighted ? 6 : 0, borderRadius: 12, background: highlighted ? 'rgba(96,165,250,0.10)' : 'transparent', boxShadow: highlighted ? '0 0 0 1px rgba(96,165,250,0.35)' : 'none', transition: 'background 0.2s, box-shadow 0.2s' }}>
      {isSoma
        ? <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.4 0.18 350)', flexShrink: 0, fontSize: 10, color: '#fff' }}>&#10022;</div>
        : <PersonAvatar person={person} size={28} />}
      <div style={{ flex: 1, minWidth: 0, maxWidth: '82%' }}>
        <div style={{ padding: '8px 12px', borderRadius: isRight ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: bc.bg }}>
          {sharedFile ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 9, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.16)' }}>
                <div style={{ width: 26, height: 32, borderRadius: 5, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.22)', color: bc.tx, fontFamily: 'monospace', fontSize: 9, flexShrink: 0 }}>FILE</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: bc.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sharedFile.name}</div>
                  <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.68)' }}>{sharedFile.meta || 'Project file'}</div>
                </div>
                <a href={sharedFile.url} target="_blank" rel="noreferrer" style={{ padding: '4px 7px', borderRadius: 6, color: bc.tx, background: 'rgba(255,255,255,0.14)', textDecoration: 'none', fontFamily: 'monospace', fontSize: 9 }}>OPEN</a>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 11, lineHeight: 1.4, color: bc.tx, margin: 0 }}><ReferenceText text={msg.content || msg.text} project={project} onOpenChannel={onOpenChannel} onOpenTask={onOpenTask} /></p>
          )}
          {msg.attachment && (
            <div style={{ marginTop: 6, paddingTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontSize: 10, borderTop: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}>
              <span>&#9634;</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.attachment}</span>
            </div>
          )}
          {!isSoma && (
            <div style={{ marginTop: 7, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.16)', display: 'flex', gap: 8, justifyContent: isRight ? 'flex-end' : 'flex-start' }}>
              <button onClick={() => onMakeTask?.(msg)} style={{ padding: 0, border: 0, background: 'none', color: 'rgba(255,255,255,0.72)', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em', cursor: 'pointer' }}>TASK</button>
              <button onClick={() => onPinDecision?.(msg)} style={{ padding: 0, border: 0, background: 'none', color: 'rgba(255,255,255,0.72)', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em', cursor: 'pointer' }}>DECISION</button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 3, fontFamily: 'monospace', fontSize: 9, color: '#2d3548', textAlign: isRight ? 'right' : 'left' }}>
          {isSoma ? 'SOMA' : senderName.split(' ')[0]} &middot; {timestamp}
        </div>
      </div>
    </div>
  );
}

function ChatRail({ project, modeColor, user, hdrs, onOpenChannel, onOpenTask, onMakeTask, onPinDecision }) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const channelId = project.channels?.[0]?.id;

  const loadChat = useCallback(async () => {
    if (!channelId) return setMessages([]);
    try {
      const d = await fetch(`/api/axis/messages?channelId=${encodeURIComponent(channelId)}&limit=50`).then(r => r.json());
      if (d.ok) setMessages(d.messages || []);
    } catch {}
  }, [channelId]);

  useEffect(() => {
    loadChat();
    if (!channelId) return undefined;
    const id = setInterval(loadChat, 5000);
    return () => clearInterval(id);
  }, [channelId, loadChat]);

  useEffect(() => {
    const refresh = event => {
      const detail = event.detail || {};
      if ((!detail.projectId || detail.projectId === project.id) && (!detail.channelId || detail.channelId === channelId)) {
        loadChat();
      }
    };
    window.addEventListener('axis:project-chat-refresh', refresh);
    return () => window.removeEventListener('axis:project-chat-refresh', refresh);
  }, [channelId, loadChat, project.id]);

  useEffect(() => {
    const focus = async event => {
      const detail = event.detail || {};
      if (detail.projectId && detail.projectId !== project.id) return;
      if (detail.channelId && detail.channelId !== channelId) return;
      await loadChat();
      setHighlightedMessageId(detail.messageId || null);
      setTimeout(() => {
        const el = document.querySelector(`[data-message-id="${detail.messageId}"]`);
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }, 80);
      setTimeout(() => setHighlightedMessageId(null), 5200);
    };
    window.addEventListener('axis:project-chat-focus', focus);
    return () => window.removeEventListener('axis:project-chat-focus', focus);
  }, [channelId, loadChat, project.id]);

  const send = async () => {
    const content = draft.trim();
    if (!channelId || !content || busy) return;
    setBusy(true);
    try {
      await fetch('/api/axis/messages', {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ channelId, content, mode: 'archive' }),
      });
      setDraft('');
      await loadChat();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'oklch(0.72 0.22 340)' }}>&#10022;</span>
          <Lbl color="oklch(0.72 0.22 340)">Chat</Lbl>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#2d3548' }}>&middot; this project</span>
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{channelId ? `#${project.channels[0].name}` : 'no channel'}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!channelId && <div style={{ color: '#5c6580', fontSize: 11 }}>No project channel exists yet.</div>}
        {channelId && messages.length === 0 && <div style={{ color: '#5c6580', fontSize: 11 }}>No project messages yet.</div>}
        {messages.map(m => <ChatBubble key={m.id} msg={m} currentUserId={user?.id} project={project} onOpenChannel={onOpenChannel} onOpenTask={onOpenTask} onMakeTask={onMakeTask} onPinDecision={onPinDecision} highlighted={highlightedMessageId === m.id} />)}
      </div>
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ padding: '0 10px 10px', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 7, background: '#111418', border: '1px solid rgba(255,255,255,0.07)' }}>
            <input disabled={!channelId} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={channelId ? 'Message the project...' : 'No project channel'} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 11, color: '#e8edf5', fontFamily: 'inherit' }} />
            <button disabled={!channelId || busy} onClick={send} title="Send" style={{ color: modeColor, background: 'none', border: 'none', cursor: channelId ? 'pointer' : 'default', fontSize: 14, fontWeight: 700, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↗</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectHeader({ project, onBack, modeColor, onOpenChannel, onOpenTask }) {
  const owner = project.owner;
  return (
    <div style={{ padding: '18px 28px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 28, borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', color: '#5c6580' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#5c6580', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, padding: 0, letterSpacing: '0.08em' }}>← HUB</button>
          <span style={{ color: '#1a2035' }}>/</span>
          <span>{project.code}</span>
          <StatusDot color={project.blockers ? 'oklch(0.66 0.22 25)' : 'oklch(0.78 0.13 162)'} pulse={project.blockers > 0} size={4} />
          <span style={{ color: project.blockers ? 'oklch(0.75 0.15 45)' : 'oklch(0.78 0.13 162)' }}>{project.blockers ? 'BLOCKED WORK' : 'TRACKING'}</span>
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 44, lineHeight: 0.95, letterSpacing: '-0.02em', color: '#e8edf5', margin: '0 0 6px' }}>{project.name}</h1>
        <p style={{ fontSize: 12, color: '#5c6580', margin: 0 }}><ReferenceText text={project.summary} project={project} onOpenChannel={onOpenChannel} onOpenTask={onOpenTask} /></p>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 12, overflow: 'hidden', background: '#111418', border: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {[
          { l: 'Progress', v: Math.round(project.progress * 100), suffix: '%', accent: true },
          { l: 'Open',     v: project.activeTasks },
          { l: 'Done',     v: project.completedTasks },
          { l: 'Blocked',  v: project.blockers, critical: project.blockers > 0 },
        ].map((s, i, arr) => (
          <div key={s.l} style={{ padding: '12px 18px', borderRight: i < arr.length-1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
            <Lbl>{s.l}</Lbl>
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 34, lineHeight: 1, color: s.accent ? modeColor : s.critical ? 'oklch(0.75 0.15 45)' : '#e8edf5' }}>{s.v}</span>
              {s.suffix && <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#2d3548' }}>{s.suffix}</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <Lbl>Owner</Lbl>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <PersonAvatar person={owner} size={22} />
            <span style={{ fontSize: 12, color: '#9ba5b7' }}>{owner?.name || 'Unassigned'}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Lbl>Team</Lbl>
          <div style={{ marginTop: 4 }}><AvatarStack ids={project.team} size={22} max={4} /></div>
        </div>
      </div>
    </div>
  );
}

function parseCSVLine(line) {
  const cells = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells;
}

function extractMdRegions(content) {
  const regions = [];
  // Markdown tables
  const tableRe = /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g;
  let m; let ti = 0;
  while ((m = tableRe.exec(content)) !== null) {
    const lines = m[1].trim().split('\n');
    const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
    const rows = lines.slice(2).map(l => l.split('|').map(c => c.trim()).filter(Boolean)).filter(r => r.length);
    if (headers.length && rows.length) {
      ti++;
      regions.push({ id: `tbl-${ti}`, kind: 'table', label: `Table ${ti}`, conf: 0.93, columns: headers, rows });
    }
  }
  // Heading sections
  const headRe = /^(#{1,3})\s+(.+)$/gm;
  const heads = []; let hm;
  while ((hm = headRe.exec(content)) !== null) heads.push({ title: hm[2], pos: hm.index });
  if (heads.length) {
    const rows = heads.map((h, i) => {
      const body = content.slice(h.pos, heads[i+1]?.pos ?? content.length).replace(/^#{1,3}\s+.+\n?/, '').trim();
      return [h.title, String(body.split(/\s+/).filter(Boolean).length), body.slice(0, 120).replace(/\n/g, ' ')];
    });
    regions.push({ id: 'sections', kind: 'sections', label: 'Document sections', conf: 0.91, columns: ['Section', 'Words', 'Preview'], rows });
  }
  return regions;
}

function extractJSONRegions(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
      const columns = [...new Set(parsed.flatMap(Object.keys))];
      const rows = parsed.slice(0, 500).map(item => columns.map(k => { const v = item[k]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }));
      return [{ id: 'records', kind: 'json-array', label: 'Records', conf: 0.97, columns, rows }];
    }
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rows = Object.entries(parsed).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
      return [{ id: 'kvp', kind: 'json-obj', label: 'Key-value pairs', conf: 0.90, columns: ['Key', 'Value'], rows }];
    }
  } catch {}
  return [];
}

function metaRegion(file) {
  return { id: 'meta', kind: 'metadata', label: 'File metadata', conf: 0.99, columns: ['Field', 'Value'],
    rows: [['Name', file.name], ['Extension', file.ext || '—'], ['Size', fmtSize(file.size)],
           ['Modified', file.modified ? new Date(file.modified).toLocaleString() : '—'], ['Path', file.path]] };
}

function ExtractToExcel({ file, onClose, onToast }) {
  const [stage,       setStage]       = useState('scanning');
  const [progress,    setProgress]    = useState(0);
  const [regions,     setRegions]     = useState([]);
  const [selected,    setSelected]    = useState(new Set());
  const [activeRegion,setActiveRegion]= useState(null);
  const [filename,    setFilename]    = useState(() => (file?.name || 'export').replace(/\.[^.]+$/, '') + '.xlsx');
  const [scanNote,    setScanNote]    = useState('Reading file…');
  const [exportErr,   setExportErr]   = useState(null);
  const AI = 'oklch(0.72 0.22 340)';

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Real scanning + extraction
  useEffect(() => {
    if (!file) return;
    let p = 0; let cancelled = false;
    const tick = setInterval(() => {
      p = Math.min(p + 4 + Math.random() * 5, 88);
      if (!cancelled) setProgress(p);
    }, 90);

    const run = async () => {
      try {
        let extracted = [];
        const ext = file.ext?.toLowerCase();

        if (ext === 'xlsx' || ext === 'xls') {
          setScanNote('Loading workbook…');
          const XLSX = await import('xlsx');
          const resp = await fetch(`/api/conceive/fs/file?path=${encodeURIComponent(file.path)}`);
          const buf  = await resp.arrayBuffer();
          setScanNote('Parsing sheets…');
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          for (const sheetName of wb.SheetNames) {
            const ws   = wb.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (data.length < 2) continue;
            const headers = (data[0] || []).map(String);
            const rows    = data.slice(1).map(row => row.map(c => c == null ? '' : String(c)));
            extracted.push({ id: sheetName, kind: 'sheet', label: sheetName, conf: 0.99, columns: headers, rows });
          }

        } else if (ext === 'csv') {
          setScanNote('Parsing CSV…');
          const resp = await fetch(`/api/conceive/fs/file?path=${encodeURIComponent(file.path)}`);
          const text = await resp.text();
          const lines = text.split('\n').filter(l => l.trim());
          if (lines.length > 1) {
            const columns = parseCSVLine(lines[0]);
            const rows    = lines.slice(1).map(parseCSVLine).filter(r => r.some(c => c));
            extracted.push({ id: 'data', kind: 'csv', label: file.name.replace(/\.csv$/i, ''), conf: 0.99, columns, rows });
          }

        } else if (ext === 'json') {
          setScanNote('Parsing JSON…');
          const r = await fetch('/api/soma/fs/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path }) });
          const d = await r.json();
          if (d.success) extracted = extractJSONRegions(d.content || '');

        } else if (ext === 'md' || ext === 'txt' || ext === 'rtf') {
          setScanNote('Parsing document…');
          const r = await fetch('/api/soma/fs/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path }) });
          const d = await r.json();
          if (d.success) {
            extracted = extractMdRegions(d.content || '');
            if (!extracted.length) {
              const lines = (d.content || '').split('\n').filter(l => l.trim());
              extracted.push({ id: 'lines', kind: 'lines', label: 'Text lines', conf: 0.70, columns: ['#', 'Line'], rows: lines.slice(0, 200).map((l, i) => [String(i + 1), l.trim()]) });
            }
          }

        } else {
          // Binary or unsupported — metadata only
          setScanNote('Extracting metadata…');
        }

        if (!extracted.length) extracted = [metaRegion(file)];

        if (!cancelled) {
          clearInterval(tick);
          setProgress(100);
          setRegions(extracted);
          setSelected(new Set(extracted.map(r => r.id)));
          setActiveRegion(extracted[0]?.id);
          setTimeout(() => setStage('review'), 180);
        }
      } catch (err) {
        if (!cancelled) {
          clearInterval(tick);
          setRegions([metaRegion(file)]);
          setSelected(new Set(['meta']));
          setActiveRegion('meta');
          setStage('review');
        }
      }
    };

    run();
    return () => { cancelled = true; clearInterval(tick); };
  }, []); // eslint-disable-line

  const toggle = id => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const totalRows = regions.filter(r => selected.has(r.id)).reduce((a, r) => a + r.rows.length, 0);

  // Real SheetJS export
  const handleExport = async () => {
    if (!selected.size) return;
    setStage('exporting');
    setExportErr(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      for (const region of regions.filter(r => selected.has(r.id))) {
        const wsData = [region.columns, ...region.rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        // Auto column widths
        ws['!cols'] = region.columns.map((col, ci) => ({
          wch: Math.min(Math.max(col.length, ...region.rows.map(row => String(row[ci] ?? '').length)) + 2, 60),
        }));
        // Freeze header row
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };
        XLSX.utils.book_append_sheet(wb, ws, region.label.slice(0, 31));
      }
      const fn = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
      XLSX.writeFile(wb, fn);
      setStage('done');
      setTimeout(() => { onClose(); onToast(`Downloaded ${fn} · ${selected.size} sheet${selected.size !== 1 ? 's' : ''} · ${totalRows} rows`); }, 800);
    } catch (err) {
      setExportErr(err.message);
      setStage('review');
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 880, maxHeight: '88vh', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0d0e12', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
        <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, oklch(0.72 0.22 340) 18%, transparent)', border: '1px solid color-mix(in oklab, oklch(0.72 0.22 340) 40%, transparent)', fontSize: 14, color: AI }}>&#10022;</div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', color: AI }}>AXIS &middot; EXTRACT &middot; {file.name}</div>
              <div style={{ fontSize: 14, color: '#e8edf5', marginTop: 2 }}>
                {stage === 'scanning' && 'Scanning for structured data…'}
                {stage === 'review'   && `Detected ${regions.length} extractable regions`}
                {stage === 'exporting' && 'Generating spreadsheet…'}
                {stage === 'done'     && 'Export complete'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5c6580', cursor: 'pointer', fontSize: 18 }}>&#10005;</button>
        </div>

        {stage === 'scanning' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
            <div style={{ width: '100%', maxWidth: 380 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Lbl color={AI}>Reading file</Lbl>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ height: 4, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.07)' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: AI, borderRadius: 999, transition: 'width 0.1s' }} />
              </div>
              <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>
                {[['Parsing document structure',15],['Detecting tables and lists',35],['Inferring column headers',55],['Classifying field types',75],['Validating against project context',92]].map(([l,t],i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: progress > t ? 1 : 0.35 }}>
                    <span style={{ color: progress > t ? 'oklch(0.78 0.13 162)' : '#2d3548' }}>{progress > t ? '✓' : '◆'}</span>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {stage === 'review' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ width: 240, flexShrink: 0, overflowY: 'auto', paddingTop: 10, borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ padding: '0 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Lbl>Regions</Lbl>
                <button onClick={() => setSelected(new Set(selected.size === regions.length ? [] : regions.map(r => r.id)))} style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em', color: '#5c6580', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {selected.size === regions.length ? 'NONE' : 'ALL'}
                </button>
              </div>
              {regions.map(r => (
                <button key={r.id} onClick={() => setActiveRegion(r.id)} style={{ width: '100%', padding: '9px 14px', display: 'flex', alignItems: 'flex-start', gap: 9, background: activeRegion === r.id ? 'rgba(255,255,255,0.04)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { if (activeRegion !== r.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if (activeRegion !== r.id) e.currentTarget.style.background = 'none'; }}>
                  <button onClick={e => { e.stopPropagation(); toggle(r.id); }} style={{ marginTop: 2, width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected.has(r.id) ? AI : 'transparent', border: `1.5px solid ${selected.has(r.id) ? AI : 'rgba(255,255,255,0.15)'}`, cursor: 'pointer', fontSize: 9, color: '#07080b', padding: 0 }}>
                    {selected.has(r.id) && '✓'}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#e8edf5' }}>{r.label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{r.rows.length} rows &middot; {r.columns.length} cols</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'color-mix(in oklab, oklch(0.72 0.22 340) 15%, transparent)', color: AI }}>{Math.round(r.conf*100)}%</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {(() => {
                const r = regions.find(x => x.id === activeRegion);
                if (!r) return null;
                return (
                  <>
                    <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 10, color: '#5c6580' }}>&#9635;</span>
                        <span style={{ fontSize: 12, color: '#e8edf5' }}>{r.label}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#2d3548' }}>Sheet preview</span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: AI }}>{Math.round(r.conf*100)}% confidence</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.10)' }}>
                        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                          <thead style={{ background: 'rgba(255,255,255,0.04)' }}>
                            <tr>
                              <th style={{ padding: '5px 8px', textAlign: 'left', fontFamily: 'monospace', fontSize: 9, color: '#2d3548', borderRight: '1px solid rgba(255,255,255,0.07)' }}>#</th>
                              {r.columns.map((c,i) => <th key={i} style={{ padding: '5px 10px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#9ba5b7', borderRight: i < r.columns.length-1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>{c}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {r.rows.map((row,ri) => (
                              <tr key={ri} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                                <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 9, color: '#2d3548', background: 'rgba(255,255,255,0.02)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>{ri+1}</td>
                                {row.map((cell,ci) => <td key={ci} style={{ padding: '5px 10px', color: '#9ba5b7', borderRight: ci < row.length-1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>{cell}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 14, padding: 12, borderRadius: 8, display: 'flex', gap: 10, background: 'color-mix(in oklab, oklch(0.72 0.22 340) 5%, transparent)', border: '1px solid color-mix(in oklab, oklch(0.72 0.22 340) 18%, transparent)' }}>
                        <span style={{ color: AI, fontSize: 10, marginTop: 2 }}>&#10022;</span>
                        <div>
                          <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em', color: AI, marginBottom: 4 }}>AXIS NOTE</div>
                          <p style={{ fontSize: 11, lineHeight: 1.6, color: '#9ba5b7', margin: 0 }}>
                            {r.kind === 'sections' && 'Detected 3 marketing copy blocks. Length counted as visible words excluding markdown formatting.'}
                            {r.kind === 'review-log' && 'Reconstructed from in-file chat comments. 3 reviewers identified.'}
                            {r.kind === 'figures' && 'Aggregated from synthesis tables. Percentages may not sum to 100 due to rounding.'}
                            {r.kind === 'frames' && 'Slide order matches the canvas; titles pulled from H1 nodes in each frame.'}
                            {r.kind === 'generic' && 'Basic metadata fields detected. Lower confidence — recommend manual review.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {(stage === 'exporting' || stage === 'done') && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
            <div style={{ textAlign: 'center' }}>
              {stage === 'exporting'
                ? <><div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.55 0.16 145)', color: '#fff', fontSize: 20 }}>X</div><div style={{ fontSize: 14, color: '#e8edf5' }}>Compiling {selected.size} sheets &middot; {totalRows} rows</div><div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>{filename}</div></>
                : <><div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, oklch(0.78 0.13 162) 18%, transparent)', border: '1px solid color-mix(in oklab, oklch(0.78 0.13 162) 40%, transparent)', fontSize: 18, color: 'oklch(0.82 0.11 162)' }}>&#10003;</div><div style={{ fontSize: 14, color: '#e8edf5' }}>Downloaded {filename}</div></>
              }
            </div>
          </div>
        )}

        {stage === 'review' && (
          <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.012)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lbl>Filename</Lbl>
                <input value={filename} onChange={e => setFilename(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, background: '#111418', border: '1px solid rgba(255,255,255,0.07)', color: '#e8edf5', width: 220 }} />
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>{selected.size} sheets &middot; {totalRows} rows</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, color: '#5c6580', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleExport} disabled={selected.size === 0} style={{ padding: '6px 16px', borderRadius: 6, fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6, background: selected.size ? 'oklch(0.55 0.16 145)' : 'rgba(255,255,255,0.06)', color: selected.size ? '#fff' : '#2d3548', border: 'none', cursor: selected.size ? 'pointer' : 'default' }}>
                ↓ EXPORT TO EXCEL
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }) {
  const cfg = {
    in_progress: { label: 'IN PROGRESS', bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
    blocked:     { label: 'BLOCKED',     bg: 'rgba(239,68,68,0.12)',  color: '#f87171' },
    review:      { label: 'REVIEW',      bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
    todo:        { label: 'TODO',        bg: 'rgba(255,255,255,0.06)', color: '#5c6580' },
    done:        { label: 'DONE',        bg: 'rgba(34,197,94,0.1)',   color: '#86efac' },
  };
  const c = cfg[status] || cfg.todo;
  return (
    <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em', background: c.bg, color: c.color }}>{c.label}</span>
  );
}

function AssignOverlay({ task, members, onClose, onAssign }) {
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const candidates = useMemo(() => {
    return members || [];
  }, [members]);

  const top = candidates[0];
  if (!task) return null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ height: '100%', width: 480, display: 'flex', flexDirection: 'column', background: '#1a1d24', borderLeft: '1px solid rgba(255,255,255,0.12)', boxShadow: '-32px 0 80px rgba(0,0,0,0.6)' }}>
        <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Lbl color="oklch(0.72 0.22 340)">Assignment · {task.id}</Lbl>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5c6580', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          <h2 style={{ fontSize: 18, color: '#e8edf5', margin: '0 0 12px', lineHeight: 1.3 }}>{task.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, fontFamily: 'monospace' }}>
            <span style={{ color: priColor(task.priority === 'high' ? 'P0' : task.priority === 'medium' ? 'P1' : 'P2') }}>{String(task.priority || 'medium').toUpperCase()}</span>
            <span style={{ color: '#2d3548' }}>·</span>
            <span style={{ color: '#5c6580' }}>Due {task.due_date ? new Date(Number(task.due_date)).toLocaleDateString() : '--'}</span>
          </div>
        </div>

        {top && <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ padding: 16, borderRadius: 12, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 12 }}>✦</span>
              <Lbl color="oklch(0.72 0.22 340)">Project owner</Lbl>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <PersonAvatar person={top} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#e8edf5' }}>{top.name}</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#5c6580', marginTop: 2 }}>{top.role} · {top.handle}</div>
              </div>
            </div>
            <p style={{ fontSize: 11, lineHeight: 1.6, color: '#9ba5b7', margin: '0 0 12px' }}>
              Assignments are persisted to the task record. Capacity and fit scoring are not available until workload evidence is connected.
            </p>
            <button onClick={() => setPick(top.id)} style={{ width: '100%', padding: '8px', borderRadius: 6, background: 'oklch(0.72 0.22 340)', color: '#07080b', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Accept recommendation
            </button>
          </div>
        </div>}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Lbl>Project members</Lbl>
            <Lbl color="#2d3548">{candidates.length}</Lbl>
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            {candidates.map(p => (
              <div key={p.id} onClick={() => setPick(p.id)}
                style={{ padding: 12, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, background: pick === p.id ? 'rgba(167,139,250,0.12)' : 'transparent', border: `1px solid ${pick === p.id ? 'rgba(167,139,250,0.3)' : 'transparent'}`, transition: 'all 0.15s' }}>
                <PersonAvatar person={p} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#e8edf5' }}>{p.name}</span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#2d3548' }}>{p.role}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#5c6580', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.handle}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '16px 24px 24px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note for assignee…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 6, background: '#111418', border: '1px solid rgba(255,255,255,0.07)', color: '#e8edf5', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 6, background: '#111418', border: '1px solid rgba(255,255,255,0.07)', color: '#9ba5b7', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
            <button disabled={!pick} onClick={() => { onAssign && onAssign(task.id, pick, note); onClose(); }}
              style={{ flex: 2, padding: '10px', borderRadius: 6, background: pick ? '#e8edf5' : 'rgba(255,255,255,0.06)', color: pick ? '#07080b' : '#2d3548', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: pick ? 'pointer' : 'default', border: 'none', fontWeight: 600 }}>
              {pick ? `Assign to ${candidates.find(p => p.id === pick)?.name.split(' ')[0]} ->` : 'Select a member'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTaskOverlay({ onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    const result = await onCreate({ title: title.trim(), priority });
    setSaving(false);
    if (result?.ok) onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, padding: 22, borderRadius: 12, background: '#111418', border: '1px solid rgba(255,255,255,0.12)' }}>
        <Lbl>New Task</Lbl>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Task title" style={{ width: '100%', marginTop: 14, padding: '10px 12px', borderRadius: 7, boxSizing: 'border-box', background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }} />
        <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 9, borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', color: '#9ba5b7', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
          <button disabled={!title.trim() || saving} onClick={submit} style={{ flex: 1, padding: 9, borderRadius: 7, border: 'none', color: '#07080b', background: '#e8edf5', cursor: 'pointer' }}>{saving ? 'Creating...' : 'Create task'}</button>
        </div>
      </div>
    </div>
  );
}

function AddMemberOverlay({ onClose, onAdd, contacts = [] }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('contributor');
  const [selectedContact, setSelectedContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    setSaving(true);
    setError('');
    const contact = contacts.find(c => c.user_id === selectedContact || c.id === selectedContact);
    const finalName = contact?.user_name || contact?.name || cleanName;
    const slug = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
    const result = await onAdd({
      userId: contact?.user_id || contact?.id || `project-${slug}-${Date.now()}`,
      userName: finalName,
      userColor: contact?.user_color || contact?.color,
      role,
    });
    setSaving(false);
    if (result?.ok) onClose();
    else setError(result?.error || 'Could not add project member.');
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, padding: 22, borderRadius: 12, background: '#111418', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 28px 80px rgba(0,0,0,0.55)' }}>
        <Lbl>Add Team Member</Lbl>
        {contacts.length > 0 && (
          <select value={selectedContact} onChange={e => {
            setSelectedContact(e.target.value);
            const contact = contacts.find(c => c.user_id === e.target.value || c.id === e.target.value);
            if (contact) setName(contact.user_name || contact.name || '');
          }} style={{ width: '100%', marginTop: 14, padding: '10px 12px', borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }}>
            <option value="">Invite by name</option>
            {contacts.map(c => <option key={c.user_id || c.id} value={c.user_id || c.id}>{c.user_name || c.name}</option>)}
          </select>
        )}
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Name" style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 7, boxSizing: 'border-box', background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }} />
        <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }}>
          <option value="contributor">Contributor</option>
          <option value="owner">Owner</option>
          <option value="reviewer">Reviewer</option>
          <option value="observer">Observer</option>
        </select>
        {error && <div style={{ marginTop: 10, fontSize: 11, color: 'oklch(0.75 0.15 45)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 9, borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', color: '#9ba5b7', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
          <button disabled={!name.trim() || saving} onClick={submit} style={{ flex: 1, padding: 9, borderRadius: 7, border: 'none', color: '#07080b', background: '#e8edf5', cursor: name.trim() && !saving ? 'pointer' : 'default', opacity: name.trim() && !saving ? 1 : 0.55 }}>{saving ? 'Adding...' : 'Add member'}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectChannelsPanel({ project, modeColor, onCreateChannel, onOpenChannel }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const channels = project.channels || [];
  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onCreateChannel({ name: name.trim(), type: 'text', description: `${name.trim()} project channel` });
    setName('');
    setSaving(false);
  };
  return (
    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Lbl color={modeColor}>Project Channels</Lbl>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#2d3548' }}>{channels.length}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {channels.map(ch => (
          <button key={ch.id} onClick={() => onOpenChannel?.(ch)} style={{ padding: '4px 8px', borderRadius: 6, fontFamily: 'monospace', fontSize: 10, color: '#9ba5b7', background: '#111418', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>#{ch.name}</button>
        ))}
        {channels.length === 0 && <span style={{ fontSize: 11, color: '#5c6580' }}>No channels yet.</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="new-channel" style={{ flex: 1, padding: '7px 9px', borderRadius: 6, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.08)', color: '#e8edf5', fontSize: 11 }} />
        <button onClick={submit} disabled={!name.trim() || saving} style={{ padding: '7px 10px', borderRadius: 6, border: 0, background: name.trim() ? '#e8edf5' : 'rgba(255,255,255,0.06)', color: name.trim() ? '#07080b' : '#2d3548', fontFamily: 'monospace', fontSize: 10, cursor: name.trim() ? 'pointer' : 'default' }}>ADD</button>
      </div>
    </div>
  );
}

function ProjectActivityPanel({ project, modeColor }) {
  const events = useMemo(() => {
    const ledger = (project.activity || []).map(row => ({
      at: row.created_at,
      label: String(row.action || '').replace(/^project\./, '').replace(/_/g, ' '),
      detail: row.summary || row.target_id || '',
    }));
    if (ledger.length) return ledger.slice(0, 10);
    const rows = [];
    if (project.created_at) rows.push({ at: project.created_at, label: 'Project created', detail: project.name });
    (project.team || []).forEach(m => rows.push({ at: m.joined_at || project.created_at || Date.now(), label: `${m.role || 'member'} joined`, detail: m.name }));
    (project.channels || []).forEach(ch => rows.push({ at: ch.created_at || project.created_at || Date.now(), label: 'Channel ready', detail: `#${ch.name}` }));
    (project.tasks || []).forEach(t => rows.push({ at: t.updated_at || t.created_at || Date.now(), label: t.status === 'done' ? 'Task completed' : 'Task tracked', detail: t.title }));
    return rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 10);
  }, [project]);
  return (
    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <Lbl color={modeColor}>Activity</Lbl>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map((event, i) => (
          <div key={`${event.label}-${i}`} style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: modeColor, marginTop: 5, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#9ba5b7' }}>{event.label}</div>
              <div style={{ fontSize: 10, color: '#3b455a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.detail}</div>
            </div>
          </div>
        ))}
        {events.length === 0 && <div style={{ fontSize: 11, color: '#5c6580' }}>No activity yet.</div>}
      </div>
    </div>
  );
}

function TaskDetailOverlay({ task, project, contacts, onClose, onUpdateTask, onAddComment }) {
  const [currentTask, setCurrentTask] = useState(task);
  const [draft, setDraft] = useState('');
  const [comments, setComments] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => setCurrentTask(task), [task]);

  useEffect(() => {
    if (!task?.id) return;
    fetch(`/api/axis/projects/${project.id}/tasks/${task.id}/comments`)
      .then(r => r.json())
      .then(d => { if (d.ok) setComments(d.comments || []); })
      .catch(() => {});
  }, [project.id, task?.id]);

  const update = async updates => {
    setCurrentTask(prev => ({ ...prev, ...updates, assignee_id: updates.assigneeId ?? prev.assignee_id, assignee_name: updates.assigneeName ?? prev.assignee_name }));
    const result = await onUpdateTask(currentTask.id, updates);
    if (result?.task) setCurrentTask(result.task);
    return result;
  };
  const post = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    const result = await onAddComment(currentTask.id, draft.trim());
    setSaving(false);
    if (result?.ok) {
      setComments(prev => [...prev, result.comment]);
      setDraft('');
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.58)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 540, height: '100%', background: '#111418', borderLeft: '1px solid rgba(255,255,255,0.12)', boxShadow: '-32px 0 90px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 22, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <Lbl>Task Detail</Lbl>
            <button onClick={onClose} style={{ background: 'none', border: 0, color: '#5c6580', cursor: 'pointer' }}>x</button>
          </div>
          <h2 style={{ margin: '10px 0 8px', color: '#e8edf5', fontSize: 20, lineHeight: 1.25 }}><ReferenceText text={currentTask.title} project={project} /></h2>
          <p style={{ margin: 0, color: '#69758d', fontSize: 12, lineHeight: 1.55 }}><ReferenceText text={currentTask.description || 'No description yet.'} project={project} /></p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 }}>
            <select value={currentTask.status || 'todo'} onChange={e => update({ status: e.target.value })} style={{ padding: 9, borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.1)', color: '#e8edf5' }}>
              <option value="todo">Todo</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select>
            <select value={currentTask.priority || 'medium'} onChange={e => update({ priority: e.target.value })} style={{ padding: 9, borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.1)', color: '#e8edf5' }}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
            <select value={currentTask.assignee_id || ''} onChange={e => {
              const member = contacts.find(c => c.id === e.target.value);
              update({ assigneeId: member?.id || '', assigneeName: member?.name || '' });
            }} style={{ padding: 9, borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.1)', color: '#e8edf5' }}>
              <option value="">Unassigned</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Lbl>Comments</Lbl>
          {comments.length === 0 && <div style={{ color: '#5c6580', fontSize: 12 }}>No task comments yet.</div>}
          {comments.map(c => (
            <div key={c.id} style={{ padding: 10, borderRadius: 8, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ fontSize: 11, color: '#9ba5b7' }}>{c.author_name || 'Member'}</div>
              <div style={{ marginTop: 5, fontSize: 12, color: '#d7ddea', lineHeight: 1.5 }}><ReferenceText text={c.content} project={project} /></div>
            </div>
          ))}
        </div>
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && post()} placeholder="Add task comment..." style={{ flex: 1, padding: '10px 12px', borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.1)', color: '#e8edf5' }} />
            <button onClick={post} disabled={!draft.trim() || saving} style={{ padding: '10px 14px', borderRadius: 7, border: 0, background: draft.trim() ? '#e8edf5' : 'rgba(255,255,255,0.06)', color: draft.trim() ? '#07080b' : '#2d3548', cursor: draft.trim() ? 'pointer' : 'default' }}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectTasksOverlay({ project, onClose, onOpenTask, onCreateTask, onUpdateTask, canManage }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('board');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (project.tasks || []).filter(task => {
      const status = task.status || 'todo';
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const matchesSearch = !needle
        || String(task.title || '').toLowerCase().includes(needle)
        || String(task.description || '').toLowerCase().includes(needle)
        || String(task.assignee_name || '').toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [project.tasks, search, statusFilter]);

  const counts = useMemo(() => {
    const base = { all: 0, todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    (project.tasks || []).forEach(task => {
      const status = task.status || 'todo';
      base.all += 1;
      if (base[status] !== undefined) base[status] += 1;
    });
    return base;
  }, [project.tasks]);
  const columns = [
    ['todo', 'Todo'],
    ['in_progress', 'In Progress'],
    ['review', 'Review'],
    ['blocked', 'Blocked'],
    ['done', 'Done'],
  ];
  const setStatus = async (task, status) => {
    if (!canManage || !onUpdateTask || task.status === status) return;
    await onUpdateTask(task.id, { status });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(860px, 94vw)', height: 'min(720px, 88vh)', display: 'flex', flexDirection: 'column', background: '#111418', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, boxShadow: '0 38px 110px rgba(0,0,0,0.65)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <Lbl>Project Tasks</Lbl>
            <div style={{ marginTop: 4, color: '#e8edf5', fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5c6580', cursor: 'pointer', fontSize: 18 }}>x</button>
        </div>

        <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '9px 11px', borderRadius: 8, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5', fontSize: 12 }}>
            <option value="all">All tasks ({counts.all})</option>
            <option value="todo">Todo ({counts.todo})</option>
            <option value="in_progress">In progress ({counts.in_progress})</option>
            <option value="review">Review ({counts.review})</option>
            <option value="blocked">Blocked ({counts.blocked})</option>
            <option value="done">Done ({counts.done})</option>
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, notes, or assignee..."
            style={{ flex: 1, minWidth: 220, padding: '9px 11px', borderRadius: 8, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5', fontSize: 12, outline: 'none' }} />
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
            {['board', 'list'].map(kind => (
              <button key={kind} onClick={() => setView(kind)} style={{ padding: '9px 10px', border: 0, borderRight: kind === 'board' ? '1px solid rgba(255,255,255,0.08)' : 0, background: view === kind ? 'rgba(232,237,245,0.12)' : '#0b0d11', color: view === kind ? '#e8edf5' : '#5c6580', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em' }}>{kind.toUpperCase()}</button>
            ))}
          </div>
          {canManage && <button onClick={onCreateTask} style={{ padding: '9px 13px', borderRadius: 8, background: '#e8edf5', color: '#07080b', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>+ Task</button>}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
          {filteredTasks.length === 0 ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#5c6580', fontSize: 12 }}>
              No tasks match this view.
            </div>
          ) : view === 'board' ? (
            <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(150px, 1fr))', gap: 10, overflowX: 'auto' }}>
              {columns.map(([status, label]) => {
                const columnTasks = filteredTasks.filter(task => (task.status || 'todo') === status);
                return (
                  <div key={status} style={{ minWidth: 150, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ padding: '8px 9px', borderRadius: 8, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Lbl>{label}</Lbl>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>{columnTasks.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {columnTasks.map(task => (
                        <div key={task.id} onClick={() => { onOpenTask(task); onClose(); }} style={{ padding: 10, borderRadius: 10, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 8.5, color: '#2d3548' }}>{task.id}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 8.5, color: '#5c6580' }}>{String(task.priority || 'medium').toUpperCase()}</span>
                          </div>
                          <div style={{ color: '#e8edf5', fontSize: 12, lineHeight: 1.35 }}>{task.title}</div>
                          <div style={{ marginTop: 7, color: '#5c6580', fontFamily: 'monospace', fontSize: 9 }}>{task.assignee_name || 'Unassigned'}</div>
                          {canManage && (
                            <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {columns.filter(([next]) => next !== status).slice(0, 3).map(([next, nextLabel]) => (
                                <button key={next} onClick={() => setStatus(task, next)} style={{ padding: '2px 5px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', color: '#5c6580', cursor: 'pointer', fontFamily: 'monospace', fontSize: 8 }}>
                                  {nextLabel}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : filteredTasks.map(task => {
            const owner = task.assignee_id ? task.assignee_name || task.assignee_id : 'Unassigned';
            return (
              <button key={task.id} onClick={() => { onOpenTask(task); onClose(); }}
                style={{ width: '100%', textAlign: 'left', padding: 12, marginBottom: 8, borderRadius: 10, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <TaskStatusBadge status={task.status || 'todo'} />
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548' }}>{task.id}</span>
                  </div>
                  <div style={{ color: '#e8edf5', fontSize: 13, lineHeight: 1.35 }}>{task.title}</div>
                  {task.description && <div style={{ marginTop: 5, color: '#5c6580', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</div>}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#5c6580', whiteSpace: 'nowrap' }}>
                  <div>{String(task.priority || 'medium').toUpperCase()}</div>
                  <div style={{ marginTop: 5 }}>{owner}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectSearchOverlay({ project, hdrs, onClose, onOpenTask }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return undefined; }
    const id = setTimeout(async () => {
      setBusy(true);
      try {
        const d = await fetch(`/api/axis/projects/${project.id}/search?q=${encodeURIComponent(q)}&limit=50`, { headers: hdrs() }).then(r => r.json());
        setResults(d.ok ? (d.results || []) : []);
      } catch { setResults([]); }
      finally { setBusy(false); }
    }, 220);
    return () => clearTimeout(id);
  }, [query, project.id, hdrs]);

  const openResult = result => {
    if (result.type === 'task') {
      const task = (project.tasks || []).find(t => t.id === result.taskId);
      if (task) onOpenTask?.(task);
      onClose();
      return;
    }
    if (result.messageId) {
      emitProjectChatFocus({ projectId: project.id, messageId: result.messageId, channelId: result.channelId });
      onClose();
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 230, background: 'rgba(0,0,0,0.58)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'start center', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: '74vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, background: '#111418', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 38px 120px rgba(0,0,0,0.62)' }}>
        <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Lbl color="oklch(0.78 0.13 200)">Project Search</Lbl>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks, decisions, messages, activity..."
            style={{ marginTop: 10, width: '100%', padding: '12px 13px', borderRadius: 9, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5', fontSize: 13, outline: 'none' }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
          {busy && <div style={{ color: '#5c6580', fontSize: 12, padding: 12 }}>Searching project...</div>}
          {!busy && query.trim() && results.length === 0 && <div style={{ color: '#5c6580', fontSize: 12, padding: 12 }}>No matching project records.</div>}
          {!query.trim() && <div style={{ color: '#5c6580', fontSize: 12, padding: 12 }}>Search includes project chat, tasks, decisions, and activity.</div>}
          {results.map(result => (
            <button key={`${result.type}-${result.id}`} onClick={() => openResult(result)}
              style={{ width: '100%', textAlign: 'left', padding: 12, marginBottom: 8, borderRadius: 10, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                <span style={{ color: '#e8edf5', fontSize: 12 }}>{result.title}</span>
                <span style={{ color: result.type === 'decision' ? 'oklch(0.84 0.14 80)' : result.type === 'task' ? 'oklch(0.74 0.13 162)' : '#5c6580', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em' }}>{String(result.type).toUpperCase()}</span>
              </div>
              <div style={{ color: '#5c6580', fontSize: 11, lineHeight: 1.45, maxHeight: 45, overflow: 'hidden' }}>{result.excerpt}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectView({ project, onBack, modeColor, onCreateTask, onAssignTask, onAddMember, onCreateChannel, onOpenChannel, onUpdateTask, onAddTaskComment, onRefresh, contacts = [], user, hdrs }) {
  const [toast, setToast] = useState(null);
  const [assignTask, setAssignTask] = useState(null);
  const [detailTask, setDetailTask] = useState(null);
  const [allTasksOpen, setAllTasksOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [extractFile, setExtractFile] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const role = project.team?.find(member => member.id === user?.id)?.role || (project.owner?.id === user?.id ? 'owner' : 'observer');
  const canManage = ['owner', 'contributor', 'reviewer'].includes(role);
  const openChannel = channel => onOpenChannel?.(project, channel);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  const handleSendFileToChat = async file => {
    if (!file) return;
    let channel = project.channels?.[0] || null;
    try {
      if (!channel?.id) {
        const result = await onCreateChannel?.({ name: 'files', type: 'text', description: `${project.name} file discussion` });
        channel = result?.channel || null;
      }
      if (!channel?.id) {
        showToast('No project chat channel available');
        return;
      }
      const url = `/api/workspace/files/${file.id}/download`;
      const message = [
        `File shared: ${file.originalName}`,
        url,
        `${fmtSize(Number(file.size || 0))} · ${String(file.ext || '').toUpperCase() || 'FILE'} · ${file.intelligence?.indexingStatus === 'indexed' || file.intelligence?.indexed ? 'indexed' : 'not indexed'}`,
      ].join('\n');
      const response = await fetch('/api/axis/messages', {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ channelId: channel.id, content: message, mode: 'archive' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not post file to chat');
      showToast('File link sent to project chat');
      window.dispatchEvent(new CustomEvent('axis:project-chat-refresh', { detail: { projectId: project.id, channelId: channel.id } }));
    } catch (e) {
      showToast(e.message || 'Could not send file to chat');
    }
  };

  const handleMessageToTask = async msg => {
    const content = String(msg?.content || msg?.text || '').trim();
    if (!content) return;
    const clean = content.replace(/\s+/g, ' ').slice(0, 90);
    const result = await onCreateTask({
      title: clean,
      description: [
        'Created from project chat.',
        `Source message: ${msg.id || 'unknown'}`,
        `From: ${msg.sender_name || msg.senderName || msg.sender_id || 'member'}`,
        '',
        content,
      ].join('\n'),
      priority: 'medium',
      tags: ['chat'],
    });
    if (result?.ok) {
      showToast('Chat message converted to task');
      onRefresh?.();
    } else {
      showToast(result?.error || 'Could not create task');
    }
  };

  const handlePinDecision = async msg => {
    const sourceText = String(msg?.content || msg?.text || '').trim();
    if (!sourceText) return;
    try {
      const response = await fetch(`/api/axis/projects/${project.id}/decisions`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({
          summary: sourceText.slice(0, 240),
          sourceText,
          sourceMessageId: msg.id,
          sourceChannelId: msg.channel_id,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not pin decision');
      showToast('Decision pinned');
      await onRefresh?.();
    } catch (e) {
      showToast(e.message || 'Could not pin decision');
    }
  };
  const handleOpenMessage = detail => {
    emitProjectChatFocus({ projectId: project.id, ...(detail || {}) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07080b', overflow: 'hidden', position: 'relative' }}>
      {/* Top strip — breadcrumb + cycle + today widget */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '9px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button onClick={onBack} style={{ fontSize: 12, color: '#5c6580', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>All projects</button>
          <span style={{ color: '#1a2035' }}>›</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5c6580' }}>{project.code}</span>
          <span style={{ fontSize: 12, color: '#9ba5b7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusDot color="oklch(0.78 0.13 162)" pulse size={5} />
            <span style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', color: '#5c6580' }}>PERSISTED PROJECT WORKSPACE</span>
          </div>
          <button onClick={() => setSearchOpen(true)} style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.035)', color: 'oklch(0.78 0.13 200)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em' }}>SEARCH</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ padding: '5px 10px', borderRadius: 7, background: 'color-mix(in oklab, oklch(0.78 0.13 200) 8%, transparent)', border: '1px solid color-mix(in oklab, oklch(0.78 0.13 200) 25%, transparent)' }}>
            <div style={{ fontSize: 10, color: 'oklch(0.85 0.10 200)', lineHeight: 1.3 }}>{project.activeTasks} open tasks</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <div style={{ width: 72, height: 3, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
                <div style={{ width: `${project.progress * 100}%`, height: '100%', background: 'oklch(0.78 0.13 200)', borderRadius: 999 }} />
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'oklch(0.78 0.08 200)' }}>{project.completedTasks}/{project.tasks.length}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
            <PersonAvatar person={user ? { id: user.id, name: user.name || 'User' } : null} size={26} />
            <div>
              <div style={{ fontSize: 12, color: '#9ba5b7', lineHeight: 1.2 }}>{user?.name || 'User'}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#2d3548', letterSpacing: '0.08em' }}>MEMBER</div>
            </div>
          </div>
        </div>
      </div>

      {/* Project header — large serif name + stats + owner */}
      <ProjectHeader project={project} onBack={onBack} modeColor={modeColor} onOpenChannel={openChannel} onOpenTask={setDetailTask} />

      {/* 3-column body */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gap: 12, padding: 14, gridTemplateColumns: '320px 1fr 360px', overflow: 'hidden' }}>
        <ProjectLeftRail project={project} onAssign={setAssignTask} onCreateTask={() => setCreatingTask(true)} onOpenTask={setDetailTask} onOpenAllTasks={() => setAllTasksOpen(true)} onOpenMessage={handleOpenMessage} onAddMember={() => setAddingMember(true)} canManage={canManage} modeColor={modeColor} />
        <ConnectedFilesPanel project={project} hdrs={hdrs} onExtract={setExtractFile} onSendToChat={handleSendFileToChat} canManage={canManage} />
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatRail project={project} modeColor={modeColor} user={user} hdrs={hdrs} onOpenChannel={openChannel} onOpenTask={setDetailTask} onMakeTask={handleMessageToTask} onPinDecision={handlePinDecision} />
        </div>
      </div>

      {creatingTask && <CreateTaskOverlay onClose={() => setCreatingTask(false)} onCreate={async (task) => {
        const result = await onCreateTask(task);
        if (result?.ok) showToast('Task created');
        return result;
      }} />}
      {searchOpen && <ProjectSearchOverlay project={project} hdrs={hdrs} onClose={() => setSearchOpen(false)} onOpenTask={setDetailTask} />}
      {allTasksOpen && <ProjectTasksOverlay project={project} canManage={canManage} onUpdateTask={async (taskId, updates) => {
        const result = await onUpdateTask(taskId, updates);
        if (result?.ok) {
          showToast('Task moved');
          await onRefresh?.();
        }
        return result;
      }} onClose={() => setAllTasksOpen(false)} onOpenTask={setDetailTask} onCreateTask={() => {
        setAllTasksOpen(false);
        setCreatingTask(true);
      }} />}
      {assignTask && <AssignOverlay task={assignTask} members={project.team} onClose={() => setAssignTask(null)} onAssign={async (id, memberId, note) => {
        const member = project.team.find(p => p.id === memberId);
        const result = await onAssignTask(id, member, note);
        if (result?.ok) showToast(`Assigned to ${member?.name || 'member'}`);
      }} />}
      {addingMember && <AddMemberOverlay contacts={contacts} onClose={() => setAddingMember(false)} onAdd={async member => {
        const result = await onAddMember(member);
        if (result?.ok) showToast('Team member added');
        return result;
      }} />}
      {detailTask && <TaskDetailOverlay task={detailTask} project={project} contacts={project.team || []} onClose={() => setDetailTask(null)} onUpdateTask={async (taskId, updates) => {
        const result = await onUpdateTask(taskId, updates);
        if (result?.ok) showToast('Task updated');
        return result;
      }} onAddComment={async (taskId, content) => {
        const result = await onAddTaskComment(taskId, content);
        if (result?.ok) showToast('Comment added');
        return result;
      }} />}
      {extractFile && <ExtractToExcel file={extractFile} onClose={() => setExtractFile(null)} onToast={showToast} />}
      {toast && (
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', borderRadius: 99, fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', background: '#e8edf5', color: '#07080b', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 100, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── CSS injection ─────────────────────────────────────────────────────────────
const AXIS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
  @keyframes axops-pulse {
    0%, 100% { transform: scale(1); opacity: 0.4; }
    50%       { transform: scale(2.4); opacity: 0; }
  }
`;

function CreateProjectOverlay({ onClose, onCreate, modeKey, modeColor }) {
  const templates = useMemo(() => templatesForMode(modeKey), [modeKey]);
  const [templateId, setTemplateId] = useState(templates[0]?.id || 'blank');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedTemplate = templates.find(t => t.id === templateId) || templates[0] || PROJECT_TEMPLATES.general[0];
  const mode = MODES[modeKey] || MODES.general;

  useEffect(() => {
    if (!templates.some(t => t.id === templateId)) setTemplateId(templates[0]?.id || 'blank');
  }, [templates, templateId]);

  const pickTemplate = template => {
    setTemplateId(template.id);
    if (!name.trim() && template.id !== 'blank') setName(template.name);
    if (!description.trim() && template.description) setDescription(template.description);
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const result = await onCreate({
      name: name.trim(),
      description: description.trim() || selectedTemplate.description || '',
      template: selectedTemplate,
      modeKey,
    });
    setSaving(false);
    if (result?.ok) onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 640, maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 22, borderRadius: 12, background: '#111418', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 32px 90px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Lbl color={modeColor}>New Project</Lbl>
            <div style={{ marginTop: 6, fontSize: 12, color: '#5c6580' }}>{mode.label} templates seed the first project tasks automatically.</div>
          </div>
          <span style={{ flexShrink: 0, padding: '5px 8px', borderRadius: 6, fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em', color: modeColor, background: `color-mix(in oklab, ${modeColor} 10%, transparent)`, border: `1px solid color-mix(in oklab, ${modeColor} 24%, transparent)` }}>{mode.lex}</span>
        </div>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, overflowY: 'auto', paddingRight: 4 }}>
          {templates.map(template => {
            const active = template.id === templateId;
            return (
              <button key={template.id} type="button" onClick={() => pickTemplate(template)}
                style={{ minHeight: 88, textAlign: 'left', padding: 12, borderRadius: 8, background: active ? `color-mix(in oklab, ${modeColor} 12%, #151a22)` : 'rgba(255,255,255,0.025)', border: active ? `1px solid color-mix(in oklab, ${modeColor} 44%, transparent)` : '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: active ? '#e8edf5' : '#c3cad8', fontWeight: 650 }}>{template.name}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: active ? modeColor : '#3b455a' }}>{template.tasks.length} TASKS</span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.45, color: '#69758d' }}>{template.summary}</p>
              </button>
            );
          })}
        </div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Project name" style={{ width: '100%', marginTop: 14, padding: '10px 12px', boxSizing: 'border-box', borderRadius: 7, background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }} />
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" rows={3} style={{ width: '100%', marginTop: 10, padding: '10px 12px', boxSizing: 'border-box', borderRadius: 7, resize: 'none', background: '#0b0d11', border: '1px solid rgba(255,255,255,0.12)', color: '#e8edf5' }} />
        {selectedTemplate?.tasks?.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Lbl>Starter Tasks</Lbl>
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {selectedTemplate.tasks.slice(0, 5).map(task => (
                <div key={task.title} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#9ba5b7' }}>{task.title}</span>
                  <span style={{ flexShrink: 0, fontFamily: 'monospace', fontSize: 9, color: '#3b455a' }}>{String(task.priority || 'medium').toUpperCase()} · +{task.dueDays || 1}D</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 9, borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', color: '#9ba5b7', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
          <button disabled={!name.trim() || saving} onClick={submit} style={{ flex: 1, padding: 9, borderRadius: 7, border: 'none', color: '#07080b', background: '#e8edf5', cursor: 'pointer' }}>{saving ? 'Creating...' : 'Create project'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AxisWorkspaceView({ workspaceType = 'operations', workspace }) {
  const { user, members, projects, tasks, setActiveProjectId, setActiveChannelId, loadProjects, createProject, createTask, updateTask, addProjectMember, addTaskComment, hdrs } = useAxis();
  const [modeKey, setModeKey] = useState(() => getWorkspaceMode(workspace?.id, workspaceType));
  const [openProjectId, setOpenProjectId] = useState(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectedProjects, setConnectedProjects] = useState([]);

  const modeColor = `oklch(0.72 0.22 ${MODES[modeKey]?.hue ?? 340})`;
  const openProject = connectedProjects.find(p => p.id === openProjectId);
  const allTasks = useMemo(() => connectedProjects.flatMap(p => p.tasks), [connectedProjects]);

  useEffect(() => {
    setModeKey(getWorkspaceMode(workspace?.id, workspaceType));
  }, [workspace?.id, workspaceType]);

  const handleModeChange = useCallback((nextMode) => {
    if (!MODES[nextMode]) return;
    setModeKey(nextMode);
    if (workspace?.id && typeof localStorage !== 'undefined') {
      localStorage.setItem(`axis_workspace_mode_${workspace.id}`, nextMode);
      localStorage.setItem(`axis_wstype_${workspace.id}`, nextMode);
      window.dispatchEvent(new CustomEvent('axis:workspace-mode-change', {
        detail: { workspaceId: workspace.id, mode: nextMode },
      }));
    }
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) return;
    setLoading(true);
    loadProjects(workspace.id).finally(() => setLoading(false));
  }, [workspace?.id, loadProjects]);

  const refreshProjectData = useCallback(async () => {
    if (!projects.length) {
      setConnectedProjects([]);
      return;
    }
    const loaded = await Promise.all(projects.map(async project => {
      const [detail, taskData] = await Promise.all([
        fetch(`/api/axis/projects/${project.id}`, { headers: hdrs() }).then(r => r.json()).catch(() => null),
        fetch(`/api/axis/projects/${project.id}/tasks`, { headers: hdrs() }).then(r => r.json()).catch(() => null),
      ]);
      const detailedProject = { ...(detail?.project || project), channels: detail?.channels || [] };
      return { ...normalizeProject(detailedProject, taskData?.tasks || [], detail?.members || []), activity: detail?.activity || [] };
    }));
    setConnectedProjects(loaded);
  }, [projects, hdrs]);

  useEffect(() => {
    refreshProjectData();
  }, [refreshProjectData]);

  useEffect(() => {
    if (openProjectId) refreshProjectData();
  }, [tasks, openProjectId, refreshProjectData]);

  const handleCreateTask = async task => {
    const result = await createTask(openProject.id, task);
    await refreshProjectData();
    return result;
  };

  const handleAssignTask = async (taskId, member, note) => {
    if (!member) return { ok: false };
    const result = await updateTask(openProject.id, taskId, { assigneeId: member.id, assigneeName: member.name });
    if (result?.ok && note?.trim()) {
      await fetch(`/api/axis/projects/${openProject.id}/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ content: note.trim() }),
      });
    }
    await refreshProjectData();
    return result;
  };

  const handleAddProjectMember = async member => {
    if (!openProject?.id) return { ok: false, error: 'No project selected' };
    const result = await addProjectMember(openProject.id, member);
    if (result?.ok) await refreshProjectData();
    return result;
  };

  const handleCreateProjectChannel = async channel => {
    if (!openProject?.id) return { ok: false, error: 'No project selected' };
    try {
      const response = await fetch(`/api/axis/projects/${openProject.id}/channels`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify(channel),
      });
      const result = await response.json().catch(() => ({}));
      if (result?.ok) await refreshProjectData();
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const handleUpdateProjectTask = async (taskId, updates) => {
    if (!openProject?.id) return { ok: false, error: 'No project selected' };
    const result = await updateTask(openProject.id, taskId, updates);
    if (result?.ok) await refreshProjectData();
    return result;
  };

  const handleAddProjectTaskComment = async (taskId, content) => {
    if (!openProject?.id) return { ok: false, error: 'No project selected' };
    return addTaskComment(openProject.id, taskId, content);
  };

  const handleOpenProjectChannel = (project, channel) => {
    if (!project?.id || !channel?.id) return;
    setActiveProjectId(project.id);
    setActiveChannelId(channel.id);
    window.dispatchEvent(new CustomEvent('axis:navigate-channel', {
      detail: { channelId: channel.id, workspaceId: workspace?.id, projectId: project.id },
    }));
  };

  // Inject font + animation CSS once
  useEffect(() => {
    if (document.getElementById('axops-styles')) return;
    const el = document.createElement('style');
    el.id = 'axops-styles';
    el.textContent = AXIS_CSS;
    document.head.appendChild(el);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#07080b', fontFamily: "'Geist', system-ui, sans-serif", color: '#e8edf5' }}>
      {openProject ? (
        <ProjectView
          project={openProject}
          onBack={() => { setOpenProjectId(null); setActiveProjectId(null); }}
          modeColor={modeColor}
          user={user}
          hdrs={hdrs}
          onCreateTask={handleCreateTask}
          onAssignTask={handleAssignTask}
          onAddMember={handleAddProjectMember}
          onCreateChannel={handleCreateProjectChannel}
          onOpenChannel={handleOpenProjectChannel}
          onUpdateTask={handleUpdateProjectTask}
          onAddTaskComment={handleAddProjectTaskComment}
          onRefresh={refreshProjectData}
          contacts={members}
        />
      ) : (
        <>
          <TitleStrip
            workspaceName={workspace?.name || 'Workspace'}
            modeKey={modeKey}
            onModeChange={handleModeChange}
            projects={connectedProjects}
            tasks={allTasks}
            user={user}
          />
          <VitalsStrip modeColor={modeColor} modeKey={modeKey} projects={connectedProjects} tasks={allTasks} />
          <div style={{ flex: 1, padding: 20, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ProjectsPanel projects={connectedProjects} onOpen={id => { setOpenProjectId(id); setActiveProjectId(id); }} onCreate={() => setCreatingProject(true)} modeColor={modeColor} loading={loading} />
          </div>
        </>
      )}
      {creatingProject && <CreateProjectOverlay modeKey={modeKey} modeColor={modeColor} onClose={() => setCreatingProject(false)} onCreate={async data => {
        const template = data.template || PROJECT_TEMPLATES.general[0];
        const result = await createProject({
          workspaceId: workspace.id,
          name: data.name,
          description: data.description,
          icon: template.id === 'blank' ? 'project' : template.id,
          color: modeKey,
        });
        if (result?.ok && result.project?.id) {
          const channelsToSeed = templateChannels(template, modeKey);
          for (const channel of channelsToSeed) {
            await fetch(`/api/axis/projects/${result.project.id}/channels`, {
              method: 'POST',
              headers: hdrs(),
              body: JSON.stringify(channel),
            }).catch(() => null);
          }
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`axis_project_template_${result.project.id}`, JSON.stringify({
              modeKey,
              templateId: template.id,
              templateName: template.name,
              channels: channelsToSeed,
              fileBuckets: templateFileBuckets(template, modeKey),
              createdAt: Date.now(),
            }));
          }
          for (const task of template.tasks || []) {
            await createTask(result.project.id, {
              title: task.title,
              description: task.description || '',
              priority: task.priority || 'medium',
              dueDate: dueDateFromDays(task.dueDays),
              tags: [modeKey, template.id].filter(Boolean),
              workspaceId: workspace.id,
            });
          }
          setOpenProjectId(result.project.id);
          setActiveProjectId(result.project.id);
          await loadProjects(workspace.id);
          await refreshProjectData();
        } else if (result?.ok) {
          await loadProjects(workspace.id);
        }
        return result;
      }} />}
    </div>
  );
}
