// mcp-example.cjs
// Example: SOMA connecting to MCP servers on iMac!

const SOMArbiterV2 = require('./arbiters/SOMArbiterV2.cjs');

async function setupMCPIntegration() {
  console.log('🔌 Setting up SOMA with MCP integration...\n');
  
  const soma = new SOMArbiterV2({
    name: 'SOMA-MCP',
    maxMicroAgents: 100
  });
  
  await soma.initialize();
  
  console.log('✅ SOMA initialized\n');
  
  // ========== DISCOVER MCP SERVERS ==========
  console.log('🔍 Discovering MCP servers on iMac...');
  
  const discovery = await soma.executeMicroTask('mcp', {
    operation: 'discover',
    urls: [
      'http://imac.local:3000/mcp/github',
      'http://imac.local:3000/mcp/filesystem',
      'http://imac.local:3000/mcp/database',
      'http://imac.local:3000/mcp/slack'
    ]
  });
  
  console.log(`  Found ${discovery.result.discovered}/${discovery.result.total} MCP servers\n`);
  
  // ========== LIST AVAILABLE SERVERS ==========
  console.log('📋 Available MCP servers:');
  
  const servers = await soma.executeMicroTask('mcp', {
    operation: 'list_servers'
  });
  
  servers.result.servers.forEach(s => {
    console.log(`  ✓ ${s.url}`);
    console.log(`    Tools: ${s.tools}`);
    console.log(`    Server: ${s.serverInfo.name || 'Unknown'} v${s.serverInfo.version || '?'}`);
  });
  
  console.log('\n');
  
  // ========== EXAMPLE 1: Call GitHub MCP ==========
  console.log('🐙 Calling GitHub MCP to search repos...');
  
  try {
    const githubResult = await soma.executeMicroTask('mcp', {
      operation: 'call',
      server: 'http://imac.local:3000/mcp/github',
      tool: 'search_repositories',
      args: {
        query: 'AI agents',
        limit: 5
      }
    });
    
    console.log(`  ✅ Found ${githubResult.result.result.length || 0} repositories`);
    console.log(`  Top repo: ${githubResult.result.result[0]?.name || 'None'}\n`);
  } catch (err) {
    console.log(`  ⚠️  GitHub MCP not available: ${err.message}\n`);
  }
  
  // ========== EXAMPLE 2: Autonomous Workflow with MCP ==========
  console.log('🤖 Setting up autonomous workflow with MCP...');
  
  await soma.executeMicroTask('automation', {
    operation: 'schedule',
    schedule: {
      id: 'mcp-github-monitor',
      type: 'interval',
      interval: 600000, // Every 10 minutes
      agent: 'workflow',
      task: {
        workflow: [
          // Step 1: Call GitHub MCP
          {
            agent: 'mcp',
            task: {
              server: 'http://imac.local:3000/mcp/github',
              tool: 'search_repositories',
              args: { query: 'machine learning', limit: 10 }
            }
          },
          // Step 2: Transform results
          {
            agent: 'transform',
            task: {
              operation: 'sort',
              params: { key: 'stars', order: 'desc' }
            },
            input: 'previous'
          },
          // Step 3: Cache results
          {
            agent: 'cache',
            task: {
              operation: 'set',
              key: 'github-ml-repos',
              ttl: 600000 // 10 min
            },
            input: 'previous'
          },
          // Step 4: Save to file
          {
            agent: 'file',
            task: {
              operation: 'write',
              path: './github-repos.json'
            },
            input: 'previous'
          }
        ],
        onError: 'continue'
      },
      retries: 2
    }
  });
  
  console.log('  ✅ Scheduled autonomous GitHub monitoring\n');
  
  // ========== EXAMPLE 3: Chained MCP Calls ==========
  console.log('🔗 Example: Chain multiple MCP servers...');
  
  console.log(`
  // This workflow would:
  // 1. Search GitHub for repos (GitHub MCP)
  // 2. Read README files (Filesystem MCP on iMac)
  // 3. Analyze sentiment of READMEs (local AnalyzeAgent)
  // 4. Store results in database (Database MCP)
  // 5. Send summary to Slack (Slack MCP)
  
  await soma.executeMicroTask('workflow', {
    workflow: [
      { agent: 'mcp', task: { server: 'github', tool: 'search_repos', ... } },
      { agent: 'mcp', task: { server: 'filesystem', tool: 'read_file', ... }, input: 'previous' },
      { agent: 'analyze', task: { analysis: 'sentiment' }, input: 'previous' },
      { agent: 'mcp', task: { server: 'database', tool: 'insert', ... }, input: 'previous' },
      { agent: 'mcp', task: { server: 'slack', tool: 'send_message', ... }, input: 'previous' }
    ]
  });
  `);
  
  console.log('\n🎉 MCP Integration Complete!');
  console.log('\n💡 Your Windows cluster can now:');
  console.log('   ✓ Call MCP servers on iMac');
  console.log('   ✓ Auto-discover available tools');
  console.log('   ✓ Chain MCP calls with local agents');
  console.log('   ✓ Run autonomous workflows with MCP');
  console.log('\n📡 SOMA ↔️ MCP ↔️ iMac = Distributed AI Cluster!\n');
  
  // Check scheduled tasks
  const schedules = await soma.executeMicroTask('automation', {
    operation: 'list'
  });
  
  console.log(`Active autonomous workflows: ${schedules.result.count}`);
  schedules.result.schedules.forEach(s => {
    console.log(`  - ${s.id} (runs every ${Math.round(s.interval / 60000)} min)`);
  });
  
  console.log('\nPress Ctrl+C to stop\n');
  
  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await soma.shutdown();
    process.exit(0);
  });
}

setupMCPIntegration().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
