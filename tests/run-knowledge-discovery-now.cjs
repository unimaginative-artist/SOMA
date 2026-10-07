#!/usr/bin/env node
(async () => {
  const { default: NighttimeLearningOrchestrator } = await import('../core/NighttimeLearningOrchestrator.js');

  const orchestrator = new NighttimeLearningOrchestrator();
  await orchestrator.initialize({});

  console.log('\n🧪 Running knowledge discovery now...');
  const result = await orchestrator.knowledgeDiscovery({
    topics: ['quantum computing', 'large language models'],
    searchTypes: ['web', 'news'],
    maxResultsPerTopic: 2
  });

  console.log('\n✅ Knowledge discovery complete:', result);
})();