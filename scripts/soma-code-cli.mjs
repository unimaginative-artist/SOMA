#!/usr/bin/env node

/**
 * soma-code-cli.mjs
 * 
 * Beautiful CLI interface for SOMA Code Assistant
 * Combines TNs + Arbiters + Micro-Agents for powerful coding workflows
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import boxen from 'boxen';
import Table from 'cli-table3';
import { TransmitterManager } from './TransmitterManager.mjs';
import { CodingArbiter } from './CodingArbiter.mjs';
import path from 'path';
import { promises as fs } from 'fs';

// ========== CONFIG ==========

const CONFIG = {
  tnPath: path.join(process.env.HOME || process.cwd(), '.soma', 'transmitters'),
  arbiterName: 'CodeMaster',
  maxConcurrentAgents: 10,
  version: '1.0.0'
};

// ========== GLOBALS ==========

let transmitterManager;
let codingArbiter;
let spinner;

// ========== COLORS ==========

const colors = {
  primary: chalk.cyan,
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  dim: chalk.gray,
  bold: chalk.bold,
  highlight: chalk.bgCyan.black
};

// ========== BANNER ==========

function showBanner() {
  const banner = chalk.cyan(`
███████╗ ██████╗ ███╗   ███╗ █████╗      ██████╗ ██████╗ ██████╗ ███████╗
██╔════╝██╔═══██╗████╗ ████║██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
███████╗██║   ██║██╔████╔██║███████║    ██║     ██║   ██║██║  ██║█████╗  
╚════██║██║   ██║██║╚██╔╝██║██╔══██║    ██║     ██║   ██║██║  ██║██╔══╝  
███████║╚██████╔╝██║ ╚═╝ ██║██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
  `);
  
  const subtitle = colors.dim('TNs + Arbiters + Micro-Agents = Coding Powerhouse');
  const version = colors.dim(`v${CONFIG.version}`);
  
  console.log(boxen(banner + '\n\n' + subtitle + '  ' + version, {
    padding: 1,
    margin: 1,
    borderStyle: 'double',
    borderColor: 'cyan'
  }));
}

// ========== INITIALIZATION ==========

async function initialize() {
  spinner = ora({
    text: 'Initializing SOMA Code...',
    color: 'cyan'
  }).start();
  
  try {
    // Initialize Transmitter Manager
    spinner.text = 'Loading memory lattice (TNs)...';
    transmitterManager = new TransmitterManager(CONFIG.tnPath, {
      logging: false,
      enable_compression: true,
      link_discovery_enabled: true
    });
    
    await new Promise(resolve => setTimeout(resolve, 500)); // Let it load
    
    const tnCount = transmitterManager.tns.size;
    spinner.succeed(colors.success(`Memory lattice loaded: ${tnCount} TNs active`));
    
    // Initialize Coding Arbiter
    spinner = ora({
      text: 'Spawning CodingArbiter...',
      color: 'cyan'
    }).start();
    
    codingArbiter = new CodingArbiter({
      name: CONFIG.arbiterName,
      memory: transmitterManager,
      maxConcurrentAgents: CONFIG.maxConcurrentAgents
    });
    
    spinner.succeed(colors.success(`CodingArbiter "${CONFIG.arbiterName}" ready`));
    
    // Show status
    showQuickStatus();
    
    return true;
    
  } catch (error) {
    spinner.fail(colors.error(`Initialization failed: ${error.message}`));
    console.error(error);
    return false;
  }
}

// ========== STATUS DISPLAY ==========

function showQuickStatus() {
  const status = codingArbiter.status();
  const tnStats = transmitterManager.stats();
  
  console.log('\n' + colors.bold('System Status:'));
  console.log(colors.dim('─'.repeat(60)));
  console.log(colors.primary('🧠 Memory:     ') + `${tnStats.tns} TNs, ${tnStats.items} items`);
  console.log(colors.primary('🤖 Arbiter:    ') + `${status.name} (Gen ${status.generation})`);
  console.log(colors.primary('⚡ Agents:     ') + `${status.activeAgents}/${CONFIG.maxConcurrentAgents} active`);
  console.log(colors.primary('📊 Tasks:      ') + `${status.metrics.tasksCompleted} completed`);
  console.log(colors.primary('🎓 Patterns:   ') + `${status.metrics.patternsLearned} learned`);
  console.log(colors.dim('─'.repeat(60)) + '\n');
}

function showDetailedStatus() {
  const status = codingArbiter.status();
  const tnStats = transmitterManager.stats();
  
  const table = new Table({
    head: [colors.cyan('Component'), colors.cyan('Status'), colors.cyan('Details')],
    colWidths: [20, 15, 50]
  });
  
  table.push(
    ['Memory Lattice', 
     colors.success('Online'), 
     `${tnStats.tns} TNs, ${tnStats.items} items, ${tnStats.compressed} compressed`],
    
    ['Coding Arbiter', 
     status.busy ? colors.warning('Busy') : colors.success('Ready'),
     `${status.name}, Gen ${status.generation}, Load: ${(status.loadLevel * 100).toFixed(1)}%`],
    
    ['Micro-Agents',
     status.activeAgents > 0 ? colors.warning(`${status.activeAgents} active`) : colors.dim('Idle'),
     `${status.metrics.agentsSpawned} spawned total`],
    
    ['Performance',
     colors.success('Good'),
     `Avg task: ${status.metrics.avgTaskTime.toFixed(0)}ms, Success: ${status.metrics.tasksCompleted}/${status.metrics.tasksCompleted + status.metrics.tasksFailed}`],
    
    ['Learning',
     status.metrics.patternsLearned > 0 ? colors.success('Active') : colors.dim('Passive'),
     `${status.metrics.patternsLearned} patterns stored`]
  );
  
  console.log('\n' + table.toString() + '\n');
}

// ========== COMMAND HANDLERS ==========

async function handleTask(description, options) {
  if (!codingArbiter) {
    console.error(colors.error('Error: System not initialized. Run without commands first.'));
    return;
  }
  
  const task = {
    description,
    type: options.type || 'generic',
    language: options.lang || 'javascript',
    files: options.files ? options.files.split(',') : []
  };
  
  spinner = ora({
    text: `Analyzing task: "${description}"`,
    color: 'cyan'
  }).start();
  
  try {
    // Execute task
    spinner.text = 'Executing task...';
    const result = await codingArbiter.execute(task);
    
    if (result.success) {
      spinner.succeed(colors.success('Task completed successfully!'));
      
      console.log('\n' + colors.bold('Result:'));
      console.log(colors.dim('─'.repeat(60)));
      console.log(colors.primary('Duration:    ') + `${result.duration}ms`);
      console.log(colors.primary('Confidence:  ') + `${(result.confidence * 100).toFixed(1)}%`);
      console.log(colors.primary('Arbiter:     ') + `${result.arbiter} (Gen ${result.generation})`);
      
      if (result.result.agentsUsed) {
        console.log(colors.primary('Agents Used: ') + result.result.agentsUsed);
      }
      
      console.log(colors.dim('─'.repeat(60)));
      console.log(JSON.stringify(result.result, null, 2));
      console.log('');
      
    } else {
      spinner.fail(colors.error('Task failed'));
      console.error(colors.error(`Error: ${result.error}`));
    }
    
  } catch (error) {
    spinner.fail(colors.error('Task execution error'));
    console.error(colors.error(error.message));
  }
}

async function handleMemorySearch(query) {
  if (!transmitterManager) {
    console.error(colors.error('Error: System not initialized.'));
    return;
  }
  
  spinner = ora({
    text: `Searching memory for: "${query}"`,
    color: 'cyan'
  }).start();
  
  try {
    // Generate embedding for query
    const queryEmbedding = await codingArbiter.generateTaskEmbedding({ description: query });
    
    // Search
    const results = await transmitterManager.hybridSearch(queryEmbedding, 10);
    
    spinner.succeed(colors.success(`Found ${results.length} relevant memories`));
    
    if (results.length === 0) {
      console.log(colors.dim('\nNo memories found matching your query.\n'));
      return;
    }
    
    console.log('\n' + colors.bold('Search Results:'));
    console.log(colors.dim('─'.repeat(60)));
    
    results.forEach((result, i) => {
      const score = (result.finalScore * 100).toFixed(1);
      const tn = result.tn;
      
      console.log(colors.primary(`\n${i + 1}. TN: ${tn.id}`) + colors.dim(` (${score}% match)`));
      console.log(colors.dim(`   Items: ${tn.meta.items}, Compressed: ${tn.meta.compressed ? 'Yes' : 'No'}`));
      
      if (tn.meta.payload) {
        const preview = JSON.stringify(tn.meta.payload).substring(0, 100);
        console.log(colors.dim(`   ${preview}...`));
      }
    });
    
    console.log(colors.dim('\n' + '─'.repeat(60)) + '\n');
    
  } catch (error) {
    spinner.fail(colors.error('Search failed'));
    console.error(colors.error(error.message));
  }
}

async function handleMaintenanceTask() {
  spinner = ora({
    text: 'Running memory lattice maintenance...',
    color: 'cyan'
  }).start();
  
  try {
    await transmitterManager.maintenanceTick();
    
    const stats = transmitterManager.stats();
    spinner.succeed(colors.success('Maintenance completed'));
    
    console.log('\n' + colors.bold('Maintenance Results:'));
    console.log(colors.dim('─'.repeat(60)));
    console.log(colors.primary('TNs:         ') + stats.tns);
    console.log(colors.primary('Compressed:  ') + stats.compressed);
    console.log(colors.primary('Total Size:  ') + `${(stats.sizeEstimate / 1024).toFixed(2)} KB`);
    console.log(colors.dim('─'.repeat(60)) + '\n');
    
  } catch (error) {
    spinner.fail(colors.error('Maintenance failed'));
    console.error(colors.error(error.message));
  }
}

async function interactiveMode() {
  console.log(colors.bold('\n🎯 Interactive Mode') + colors.dim(' (type "exit" to quit)\n'));
  
  while (true) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '💻 Execute coding task', value: 'task' },
        { name: '🔍 Search memory', value: 'search' },
        { name: '📊 Show detailed status', value: 'status' },
        { name: '🔧 Run maintenance', value: 'maintenance' },
        { name: '🚪 Exit', value: 'exit' }
      ]
    }]);
    
    if (action === 'exit') {
      console.log(colors.success('\n✨ Goodbye!\n'));
      break;
    }
    
    if (action === 'task') {
      const { description } = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: 'Describe the coding task:'
      }]);
      
      await handleTask(description, {});
    }
    
    if (action === 'search') {
      const { query } = await inquirer.prompt([{
        type: 'input',
        name: 'query',
        message: 'Search memory for:'
      }]);
      
      await handleMemorySearch(query);
    }
    
    if (action === 'status') {
      showDetailedStatus();
    }
    
    if (action === 'maintenance') {
      await handleMaintenanceTask();
    }
  }
}

// ========== CLI SETUP ==========

program
  .name('soma')
  .description('SOMA Code - AI-powered coding assistant with memory lattice')
  .version(CONFIG.version);

program
  .command('task <description>')
  .description('Execute a coding task')
  .option('-t, --type <type>', 'Task type (lint, test, refactor, etc.)')
  .option('-l, --lang <language>', 'Programming language', 'javascript')
  .option('-f, --files <files>', 'Comma-separated file list')
  .action(handleTask);

program
  .command('search <query>')
  .description('Search memory for past patterns')
  .action(handleMemorySearch);

program
  .command('status')
  .description('Show detailed system status')
  .action(showDetailedStatus);

program
  .command('maintenance')
  .description('Run memory lattice maintenance')
  .action(handleMaintenanceTask);

program
  .command('interactive')
  .alias('i')
  .description('Enter interactive mode')
  .action(async () => {
    await initialize();
    await interactiveMode();
  });

// ========== MAIN ==========

async function main() {
  // If no command provided, show banner and enter interactive mode
  if (process.argv.length === 2) {
    showBanner();
    const initialized = await initialize();
    
    if (initialized) {
      await interactiveMode();
    } else {
      process.exit(1);
    }
  } else {
    // Initialize before running commands
    await initialize();
    await program.parseAsync(process.argv);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(colors.error('\n❌ Unhandled error:'), error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log(colors.warning('\n\n⚠️  Interrupted by user'));
  process.exit(0);
});

// Run
main().catch((error) => {
  console.error(colors.error('\n❌ Fatal error:'), error);
  process.exit(1);
});
