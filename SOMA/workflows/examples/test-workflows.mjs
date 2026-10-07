/**
 * Test script for SOMA workflows
 * Demonstrates how to register and execute example workflows
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://localhost:3001';

// Helper function to make API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  return await response.json();
}

// Test 1: Register and execute simple greeting workflow
async function testSimpleGreeting() {
  console.log('\n=== Test 1: Simple Greeting Workflow ===\n');

  // Load workflow
  const workflow = JSON.parse(
    fs.readFileSync(path.join(__dirname, '01-simple-greeting.json'), 'utf8')
  );

  // Register
  console.log('Registering workflow...');
  const registerResult = await apiCall('/api/workflows/register', 'POST', { workflow });
  console.log('✅ Registered:', registerResult.success ? 'Success' : 'Failed');

  // Execute
  console.log('\nExecuting workflow...');
  const execResult = await apiCall('/api/workflows/execute', 'POST', {
    workflowId: workflow.id,
    input: { message: 'Hello from test script!' }
  });

  console.log('✅ Execution:', execResult.success ? 'Success' : 'Failed');
  console.log('   Final State:', execResult.finalState);
  console.log('   Duration:', execResult.duration + 'ms');

  return execResult;
}

// Test 2: Sequential chain from template
async function testSequentialChain() {
  console.log('\n=== Test 2: Sequential Chain (Data Pipeline Template) ===\n');

  const chainResult = await apiCall('/api/chains/template', 'POST', {
    template: 'data-pipeline',
    options: {
      name: 'Test Data Pipeline',
      extractParams: { source: 'test-api', endpoint: '/data' },
      transformParams: { operations: ['normalize', 'validate'] },
      loadParams: { destination: 'test-db' }
    },
    register: false // Just build, don't register
  });

  console.log('✅ Chain built:', chainResult.success ? 'Success' : 'Failed');
  console.log('   Workflow ID:', chainResult.workflow?.id);
  console.log('   States:', Object.keys(chainResult.workflow?.states || {}).length);
  console.log('   Summary:', JSON.stringify(chainResult.summary, null, 2));

  return chainResult;
}

// Test 3: Parallel execution
async function testParallelExecution() {
  console.log('\n=== Test 3: Parallel Workflow Execution ===\n');

  // First, register two simple workflows
  const workflow1 = {
    id: 'parallel_test_1',
    name: 'Parallel Test 1',
    initialState: 'action1',
    states: {
      action1: {
        type: 'action',
        action: 'test:parallel1',
        parameters: { delay: 1000 },
        onSuccess: 'complete',
        onError: 'error'
      },
      complete: { type: 'terminal', status: 'completed' },
      error: { type: 'terminal', status: 'failed' }
    }
  };

  const workflow2 = {
    id: 'parallel_test_2',
    name: 'Parallel Test 2',
    initialState: 'action2',
    states: {
      action2: {
        type: 'action',
        action: 'test:parallel2',
        parameters: { delay: 1500 },
        onSuccess: 'complete',
        onError: 'error'
      },
      complete: { type: 'terminal', status: 'completed' },
      error: { type: 'terminal', status: 'failed' }
    }
  };

  // Register both workflows
  await apiCall('/api/workflows/register', 'POST', { workflow: workflow1 });
  await apiCall('/api/workflows/register', 'POST', { workflow: workflow2 });

  // Execute in parallel
  console.log('Executing workflows in parallel (strategy: all)...');
  const parallelResult = await apiCall('/api/parallel/execute', 'POST', {
    workflows: [
      { id: workflow1.id, name: workflow1.name, input: {} },
      { id: workflow2.id, name: workflow2.name, input: {} }
    ],
    options: {
      strategy: 'all', // Wait for all to complete
      timeout: 60000
    }
  });

  console.log('✅ Parallel execution:', parallelResult.success ? 'Success' : 'Failed');
  console.log('   Strategy:', parallelResult.strategy);
  console.log('   Duration:', parallelResult.duration + 'ms');
  console.log('   Results:', parallelResult.results?.length || 0, 'workflows completed');

  return parallelResult;
}

// Test 4: Fan-out pattern
async function testFanOut() {
  console.log('\n=== Test 4: Fan-Out Pattern ===\n');

  // Create a simple workflow to fan-out
  const workflow = {
    id: 'fanout_test',
    name: 'Fan-Out Test',
    initialState: 'process',
    states: {
      process: {
        type: 'action',
        action: 'test:process_item',
        parameters: {},
        onSuccess: 'complete',
        onError: 'error'
      },
      complete: { type: 'terminal', status: 'completed' },
      error: { type: 'terminal', status: 'failed' }
    }
  };

  await apiCall('/api/workflows/register', 'POST', { workflow });

  // Fan-out with multiple inputs
  console.log('Fan-out processing 5 items...');
  const fanOutResult = await apiCall('/api/parallel/fanout', 'POST', {
    workflowId: workflow.id,
    inputs: [
      { item: 1, value: 'Alpha' },
      { item: 2, value: 'Beta' },
      { item: 3, value: 'Gamma' },
      { item: 4, value: 'Delta' },
      { item: 5, value: 'Epsilon' }
    ],
    options: {
      strategy: 'all'
    }
  });

  console.log('✅ Fan-out:', fanOutResult.success ? 'Success' : 'Failed');
  console.log('   Orchestration ID:', fanOutResult.orchestrationId);
  console.log('   Duration:', fanOutResult.duration + 'ms');
  console.log('   Processed:', fanOutResult.results?.length || 0, 'items');

  return fanOutResult;
}

// Test 5: Get workflow statistics
async function testWorkflowStats() {
  console.log('\n=== Test 5: Workflow Statistics ===\n');

  // Get list of all workflows
  const listResult = await apiCall('/api/workflows/list');
  console.log('Total workflows:', listResult.workflows?.length || 0);

  // Get stats for first workflow
  if (listResult.workflows && listResult.workflows.length > 0) {
    const firstWorkflow = listResult.workflows[0];
    console.log('\nStats for:', firstWorkflow.name);

    const stats = await apiCall(`/api/workflows/${firstWorkflow.id}/stats`);
    console.log('   Total executions:', stats.stats?.totalExecutions || 0);
    console.log('   Successful:', stats.stats?.successfulExecutions || 0);
    console.log('   Failed:', stats.stats?.failedExecutions || 0);
    console.log('   Success rate:', stats.stats?.successRate || 'N/A');
    console.log('   Avg duration:', (stats.stats?.avgDuration || 0) + 'ms');
  }

  // Get global stats
  const globalStats = await apiCall('/api/workflows/stats/global');
  console.log('\nGlobal statistics:');
  console.log('   Active workflows:', globalStats.stats?.activeWorkflows || 0);
  console.log('   Total executions:', globalStats.stats?.totalExecutions || 0);
  console.log('   Active executions:', globalStats.stats?.activeExecutions || 0);
}

// Main test runner
async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  SOMA Workflow System - Integration Tests           ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  try {
    // Check server connection
    console.log('\nChecking server connection...');
    const statusResult = await apiCall('/api/workflows/list');
    console.log('✅ Server connected:', BASE_URL);

    // Run tests
    await testSimpleGreeting();
    await testSequentialChain();
    // await testParallelExecution(); // Commented out - requires full backend
    // await testFanOut(); // Commented out - requires full backend
    await testWorkflowStats();

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  ✅ All Tests Completed Successfully                 ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('   Make sure the SOMA server is running on port 3001');
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests();
}

export {
  testSimpleGreeting,
  testSequentialChain,
  testParallelExecution,
  testFanOut,
  testWorkflowStats
};
