// autonomous-example.cjs
// Example of SOMA running COMPLETELY AUTONOMOUSLY!

const SOMArbiterV2 = require('./arbiters/SOMArbiterV2.cjs');

async function setupAutonomousSOMA() {
  console.log('🤖 Setting up AUTONOMOUS SOMA system...\n');
  
  const soma = new SOMArbiterV2({
    name: 'Autonomous-SOMA',
    maxMicroAgents: 100
  });
  
  await soma.initialize();
  
  console.log('✅ SOMA initialized\n');
  
  // ========== AUTONOMOUS WORKFLOW 1: Data Collection Pipeline ==========
  console.log('📊 Setting up autonomous data collection...');
  
  await soma.executeMicroTask('automation', {
    operation: 'schedule',
    schedule: {
      id: 'data-collection-pipeline',
      type: 'interval',
      interval: 300000, // Every 5 minutes
      agent: 'workflow',
      task: {
        workflow: [
          // Step 1: Fetch from API
          {
            agent: 'fetch',
            task: {
              url: 'https://api.github.com/repos/nodejs/node/commits',
              method: 'GET',
              parse: 'json'
            }
          },
          // Step 2: Transform - extract just what we need
          {
            agent: 'transform',
            task: {
              operation: 'map',
              params: {
                transform: {
                  sha: 'sha',
                  message: 'commit.message',
                  author: 'commit.author.name',
                  date: 'commit.author.date'
                }
              }
            },
            input: 'previous'
          },
          // Step 3: Cache the results
          {
            agent: 'cache',
            task: {
              operation: 'set',
              key: 'latest-node-commits',
              ttl: 300000 // 5 min cache
            },
            input: 'previous'
          }
        ],
        onError: 'continue' // Keep going even if one step fails
      },
      retries: 2
    }
  });
  
  console.log('  ✅ Scheduled data collection (runs every 5 min)\n');
  
  // ========== AUTONOMOUS WORKFLOW 2: File Monitoring ==========
  console.log('📁 Setting up autonomous file monitoring...');
  
  await soma.executeMicroTask('automation', {
    operation: 'schedule',
    schedule: {
      id: 'file-monitor',
      type: 'interval',
      interval: 60000, // Every minute
      agent: 'workflow',
      task: {
        workflow: [
          // Step 1: List files in directory
          {
            agent: 'file',
            task: {
              operation: 'list',
              path: '.',
              recursive: false
            }
          },
          // Step 2: Filter for recent files (modified in last hour)
          {
            agent: 'transform',
            task: {
              operation: 'filter',
              params: {
                predicate: (file) => {
                  const hourAgo = Date.now() - (60 * 60 * 1000);
                  return new Date(file.modified).getTime() > hourAgo;
                }
              }
            },
            input: 'previous'
          },
          // Step 3: Analyze the file list
          {
            agent: 'analyze',
            task: {
              analysis: 'structure'
            },
            input: 'previous'
          }
        ]
      }
    }
  });
  
  console.log('  ✅ Scheduled file monitoring (runs every minute)\n');
  
  // ========== AUTONOMOUS WORKFLOW 3: Cache Maintenance ==========
  console.log('🧹 Setting up autonomous cache maintenance...');
  
  await soma.executeMicroTask('automation', {
    operation: 'schedule',
    schedule: {
      id: 'cache-purge',
      type: 'interval',
      interval: 120000, // Every 2 minutes
      agent: 'cache',
      task: {
        operation: 'purge' // Remove expired entries
      }
    }
  });
  
  console.log('  ✅ Scheduled cache purge (runs every 2 min)\n');
  
  // ========== AUTONOMOUS WORKFLOW 4: One-Time Scheduled Task ==========
  console.log('⏰ Setting up one-time scheduled task...');
  
  const futureTime = new Date(Date.now() + 120000); // 2 minutes from now
  
  await soma.executeMicroTask('automation', {
    operation: 'schedule',
    schedule: {
      id: 'one-time-report',
      type: 'once',
      time: futureTime.toISOString(),
      agent: 'workflow',
      task: {
        workflow: [
          // Get cache stats
          {
            agent: 'cache',
            task: { operation: 'stats' }
          },
          // Log them (in real system, could send to API or save to file)
          {
            agent: 'analyze',
            task: { analysis: 'structure' },
            input: 'previous'
          }
        ]
      }
    }
  });
  
  console.log(`  ✅ Scheduled one-time report for ${futureTime.toLocaleTimeString()}\n`);
  
  // ========== STATUS ==========
  console.log('📋 Checking scheduled tasks...\n');
  
  const schedules = await soma.executeMicroTask('automation', {
    operation: 'list'
  });
  
  console.log(`Active schedules: ${schedules.result.count}`);
  schedules.result.schedules.forEach(s => {
    const nextRun = new Date(s.nextRun).toLocaleTimeString();
    console.log(`  - ${s.id} (${s.type}) - next run: ${nextRun}`);
  });
  
  console.log('\n🎉 SOMA is now FULLY AUTONOMOUS!');
  console.log('   - Data collection running every 5 min');
  console.log('   - File monitoring running every minute');
  console.log('   - Cache maintenance running every 2 min');
  console.log('   - One-time report scheduled');
  console.log('\n💡 SOMA will keep running these tasks automatically!');
  console.log('   Press Ctrl+C to stop\n');
  
  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down autonomous SOMA...');
    await soma.shutdown();
    process.exit(0);
  });
}

setupAutonomousSOMA().catch(err => {
  console.error('❌ Failed to setup autonomous SOMA:', err);
  process.exit(1);
});
