export class MemoryRetrievalQualityGate {
  constructor({ minimumRecallAtK = 0.8, minimumMrr = 0.65, topK = 5 } = {}) {
    this.minimumRecallAtK = minimumRecallAtK;
    this.minimumMrr = minimumMrr;
    this.topK = topK;
  }

  async evaluate(retriever, fixtures = []) {
    if (!retriever?.search && !retriever?.recall) throw new Error('retriever.search or retriever.recall is required');
    const cases = [];
    let reciprocalRank = 0;
    let recalled = 0;
    for (const fixture of fixtures) {
      const payload = retriever.search
        ? await retriever.search(fixture.query, { limit: this.topK })
        : await retriever.recall(fixture.query, this.topK);
      const results = payload?.results || payload || [];
      const match = row => {
        if (fixture.expectedIds?.includes(row.id || row.memoryId)) return true;
        const content = String(row.content || '').toLowerCase();
        if ((fixture.contentIncludes || []).length && fixture.contentIncludes.every(term => content.includes(String(term).toLowerCase()))) return true;
        return (fixture.contentAnyOf || []).some(group => group.every(term => content.includes(String(term).toLowerCase())));
      };
      const rank = results.findIndex(match) + 1;
      if (rank > 0) {
        recalled++;
        reciprocalRank += 1 / rank;
      }
      cases.push({ name: fixture.name, query: fixture.query, passed: rank > 0, rank: rank || null, resultIds: results.map(row => row.id || row.memoryId) });
    }
    const denominator = Math.max(1, fixtures.length);
    const metrics = {
      fixtureCount: fixtures.length,
      recallAtK: recalled / denominator,
      mrr: reciprocalRank / denominator,
      topK: this.topK
    };
    return {
      passed: fixtures.length > 0 && metrics.recallAtK >= this.minimumRecallAtK && metrics.mrr >= this.minimumMrr,
      thresholds: { minimumRecallAtK: this.minimumRecallAtK, minimumMrr: this.minimumMrr },
      metrics,
      cases
    };
  }

  compare(candidate, baseline) {
    const candidateMetrics = candidate?.metrics || {};
    const baselineMetrics = baseline?.metrics || {};
    const wins = candidate?.passed === true
      && Number(candidateMetrics.recallAtK || 0) >= Number(baselineMetrics.recallAtK || 0)
      && Number(candidateMetrics.mrr || 0) > Number(baselineMetrics.mrr || 0);
    return {
      passed: wins,
      reason: wins ? 'candidate_beats_baseline' : 'candidate_did_not_beat_baseline',
      deltas: {
        recallAtK: Number(candidateMetrics.recallAtK || 0) - Number(baselineMetrics.recallAtK || 0),
        mrr: Number(candidateMetrics.mrr || 0) - Number(baselineMetrics.mrr || 0)
      }
    };
  }
}

export default MemoryRetrievalQualityGate;
