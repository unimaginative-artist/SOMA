import { useCallback, useEffect, useMemo, useState } from 'react';
import { ctAuthHeaders } from '../services/CtAuth.js';

const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled']);

function normalizeGoal(goal = {}, statusOverride) {
  const rawStatus = String(statusOverride || goal.status || 'queued').toLowerCase();
  const failedStates = new Set(['failed', 'broken', 'verification_failed', 'rejected', 'abandoned']);
  const status = rawStatus === 'active' || rawStatus === 'in_progress'
    ? 'executing'
    : failedStates.has(rawStatus)
      ? 'blocked'
      : rawStatus;
  return {
    id: goal.id || goal.goalId,
    title: goal.title || goal.description || 'Untitled background job',
    status,
    updatedAt: goal.updatedAt || goal.completedAt || goal.startedAt || goal.createdAt || Date.now(),
    artifact: goal.metadata?.expectedArtifact || goal.metadata?.artifactPath || goal.artifact,
    receipt: goal.metadata?.latestExecutionReceipt || goal.metadata?.receiptPath || goal.receipt,
    reason: goal.metadata?.failureReason || goal.reason
    ,progress: goal.metrics?.progress ?? goal.progress ?? goal.evidenceProgress?.progress ?? 0
    ,createdAt: goal.createdAt
    ,startedAt: goal.startedAt
    ,completedAt: goal.completedAt
    ,attempts: goal.executionAttempts || 0
    ,maxAttempts: goal.maxAttempts || goal.metadata?.contract?.maxAttempts
    ,timeline: goal.lifecycleHistory || []
  };
}

export function useGoalJobs() {
  const [jobsById, setJobsById] = useState({});

  const upsert = useCallback((job) => {
    if (!job?.id) return;
    setJobsById(previous => ({
      ...previous,
      [job.id]: { ...previous[job.id], ...job, updatedAt: Date.now() }
    }));
  }, []);

  const ingestGoalEvent = useCallback((eventName, envelope = {}) => {
    const payload = envelope.payload || envelope;
    const goal = payload.goal || payload;
    const statusByEvent = {
      goal_created: 'queued',
      goal_started: 'executing',
      goal_completed: 'completed',
      goal_failed: 'blocked'
    };
    upsert(normalizeGoal({ ...goal, reason: payload.reason }, statusByEvent[eventName]));
  }, [upsert]);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/soma/goals', { headers: ctAuthHeaders(), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Goals API ${response.status}`);
    const data = await response.json();
    const goals = Array.isArray(data) ? data : (data.goals || []);
    const initial = {};
    for (const goal of goals) {
      const normalized = normalizeGoal(goal);
      if (normalized.id && (!TERMINAL.has(normalized.status) || Date.now() - Number(normalized.completedAt || 0) < 300_000)) {
        initial[normalized.id] = normalized;
      }
    }
    setJobsById(initial);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {});
    const interval = setInterval(() => !cancelled && refresh().catch(() => {}), 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [refresh]);

  const cancel = useCallback(async id => {
    const response = await fetch(`/api/soma/goals/${encodeURIComponent(id)}`, { method: 'DELETE', headers: ctAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ reason: 'Cancelled by Owner in SOMA CT' }) });
    if (!response.ok) throw new Error(`Cancel failed (${response.status})`);
    await refresh();
  }, [refresh]);

  const retry = useCallback(async id => {
    const response = await fetch(`/api/soma/goals/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: ctAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ reason: 'Retried by Owner in SOMA CT' }) });
    if (!response.ok) throw new Error(`Retry failed (${response.status})`);
    await refresh();
  }, [refresh]);

  const jobs = useMemo(() => Object.values(jobsById)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8), [jobsById]);

  return { jobs, ingestGoalEvent, cancel, retry, refresh };
}
