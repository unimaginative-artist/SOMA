#!/usr/bin/env node

/**
 * soma-cli.mjs
 * Main CLI entry point for SOMA
 * Provides command-line interface to interact with SOMA's autonomous systems
 */

import { createRequire } from 'module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';

const require = createRequire(import.meta.url);
const { CliArbiter } = require('../arbiters/CliArbiter.cjs');

// ═══════════════════════════════════════════════════════════
// ░░ CLI SETUP ░░
// ═══════════════════════════════════════════════════════════

let cliArbiter = null;
let isInteractive = false;

async function initializeCli() {
  const spinner = ora('Initializing SOMA CLI...').start();

  try {
    cliArbiter = new CliArbiter({ name: 'CliArbiter' });
    await cliArbiter.initialize();
    spinner.succeed('SOMA CLI ready');
  } catch (err) {
    spinner.fail('Failed to initialize CLI');
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════
// ░░ COMMAND HANDLERS ░░
// ═══════════════════════════════════════════════════════════

async function executeCommand(commandString) {
  const spinner = ora('Processing...').start();

  try {
    const result = await cliArbiter.processCommand(commandString);
    spinner.stop();
    console.log(result);
  } catch (err) {
    spinner.fail('Command failed');
    console.error(chalk.red(`Error: ${err.message}`));
  }
}

// ═══════════════════════════════════════════════════════════
// ░░ COMMAND DEFINITIONS ░░
// ═══════════════════════════════════════════════════════════

const cli = yargs(hideBin(process.argv))
  .scriptName('soma')
  .usage('$0 <command> [options]')
  .version('1.0.0')
  .help();

// Goals commands
cli.command(
  'goals <action>',
  'Manage SOMA goals',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['list', 'status', 'create', 'active', 'completed', 'autonomous']
      })
      .option('id', {
        describe: 'Goal ID',
        type: 'string'
      })
      .option('title', {
        describe: 'Goal title',
        type: 'string'
      })
      .option('priority', {
        describe: 'Goal priority',
        choices: ['low', 'medium', 'high', 'urgent']
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `goals:${argv.action}`;
    const args = Object.entries(argv)
      .filter(([key]) => !['_', '$0', 'action'].includes(key))
      .map(([key, val]) => `--${key} ${val}`)
      .join(' ');
    await executeCommand(`${command} ${args}`);
    process.exit(0);
  }
);

// Research commands
cli.command(
  'research <action>',
  'Manage autonomous research',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['start', 'status', 'history', 'workers', 'config']
      })
      .option('topic', {
        describe: 'Research topic',
        type: 'string'
      })
      .option('depth', {
        describe: 'Crawl depth',
        type: 'number'
      })
      .option('priority', {
        describe: 'Research priority',
        choices: ['low', 'medium', 'high']
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `research:${argv.action}`;
    const args = Object.entries(argv)
      .filter(([key]) => !['_', '$0', 'action'].includes(key))
      .map(([key, val]) => `--${key} ${val}`)
      .join(' ');
    await executeCommand(`${command} ${args}`);
    process.exit(0);
  }
);

// Skills commands
cli.command(
  'skills <action>',
  'Manage skill acquisition',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['list', 'practice', 'gaps', 'certified', 'learn', 'progress']
      })
      .option('skill', {
        describe: 'Skill name',
        type: 'string'
      })
      .option('topic', {
        describe: 'Learning topic',
        type: 'string'
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `skills:${argv.action}`;
    const args = Object.entries(argv)
      .filter(([key]) => !['_', '$0', 'action'].includes(key))
      .map(([key, val]) => `--${key} ${val}`)
      .join(' ');
    await executeCommand(`${command} ${args}`);
    process.exit(0);
  }
);

// Schedule commands
cli.command(
  'schedule <action>',
  'Manage autonomous scheduling',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['list', 'next', 'load', 'add', 'pause', 'resume', 'trigger']
      })
      .option('rhythm', {
        describe: 'Rhythm ID',
        type: 'string'
      })
      .option('cron', {
        describe: 'Cron pattern',
        type: 'string'
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `schedule:${argv.action}`;
    const args = Object.entries(argv)
      .filter(([key]) => !['_', '$0', 'action'].includes(key))
      .map(([key, val]) => `--${key} ${val}`)
      .join(' ');
    await executeCommand(`${command} ${args}`);
    process.exit(0);
  }
);

// Codebase commands
cli.command(
  'codebase <action>',
  'Analyze and improve codebase',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['scan', 'health', 'opportunities', 'insights', 'patterns']
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `codebase:${argv.action}`;
    await executeCommand(command);
    process.exit(0);
  }
);

// Prediction commands
cli.command(
  'predict <action>',
  'User anticipation and prediction',
  (yargs) => {
    yargs
      .positional('action', {
        describe: 'Action to perform',
        choices: ['next', 'context']
      })
      .option('text', {
        describe: 'Context text',
        type: 'string'
      });
  },
  async (argv) => {
    await initializeCli();
    const command = `predict:${argv.action}`;
    const args = argv.text ? `--text "${argv.text}"` : '';
    await executeCommand(`${command} ${args}`);
    process.exit(0);
  }
);

// Suggest command (shortcut)
cli.command(
  'suggest',
  'Get proactive suggestions',
  {},
  async () => {
    await initializeCli();
    await executeCommand('suggest');
    process.exit(0);
  }
);

// Status command
cli.command(
  'status',
  'Show SOMA system status',
  (yargs) => {
    yargs.option('detailed', {
      describe: 'Show detailed status',
      type: 'boolean',
      default: false
    });
  },
  async (argv) => {
    await initializeCli();
    console.log(chalk.cyan('\n🧠 SOMA System Status\n'));

    // Show CLI stats
    const stats = cliArbiter.getStats();
    console.log(chalk.bold('CLI:'));
    console.log(`  Commands executed: ${stats.commandsExecuted}`);
    console.log(`  Commands available: ${stats.commandsRegistered}`);

    if (argv.detailed) {
      console.log(chalk.bold('\nRecent commands:'));
      stats.recentCommands.forEach(cmd => {
        const date = new Date(cmd.timestamp).toLocaleTimeString();
        console.log(`  [${date}] ${cmd.command}`);
      });
    }

    console.log();
    process.exit(0);
  }
);

// Interactive mode
cli.command(
  ['*', 'interactive'],
  'Enter interactive mode',
  {},
  async () => {
    await initializeCli();
    await startInteractiveMode();
  }
);

// ═══════════════════════════════════════════════════════════
// ░░ INTERACTIVE MODE ░░
// ═══════════════════════════════════════════════════════════

async function startInteractiveMode() {
  isInteractive = true;

  console.log(chalk.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.cyan('║      SOMA Interactive Mode            ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));
  console.log(chalk.gray('Type "help" for commands, "exit" to quit\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('soma> ')
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit') {
      console.log(chalk.cyan('\nGoodbye! 👋\n'));
      rl.close();
      process.exit(0);
    }

    if (input === 'help') {
      showInteractiveHelp();
      rl.prompt();
      return;
    }

    if (input === 'clear') {
      console.clear();
      rl.prompt();
      return;
    }

    try {
      const result = await cliArbiter.processCommand(input);
      console.log(result);
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.cyan('\nGoodbye! 👋\n'));
    process.exit(0);
  });
}

function showInteractiveHelp() {
  console.log(chalk.bold('\nAvailable Commands:\n'));
  console.log(chalk.cyan('Goals:'));
  console.log('  goals:list             List all goals');
  console.log('  goals:active           Show active goals');
  console.log('  goals:create           Create new goal');

  console.log(chalk.cyan('\nResearch:'));
  console.log('  research:start <topic> Start research on topic');
  console.log('  research:status        Research status');
  console.log('  research:history       Research history');

  console.log(chalk.cyan('\nSkills:'));
  console.log('  skills:list            List all skills');
  console.log('  skills:gaps            Show knowledge gaps');
  console.log('  skills:certified       Show certified skills');

  console.log(chalk.cyan('\nSchedule:'));
  console.log('  schedule:list          List scheduled rhythms');
  console.log('  schedule:next          Next scheduled event');
  console.log('  schedule:load          System load status');

  console.log(chalk.cyan('\nCodebase:'));
  console.log('  codebase:scan          Scan codebase');
  console.log('  codebase:health        Code health metrics');
  console.log('  codebase:opportunities Improvement opportunities');

  console.log(chalk.cyan('\nOther:'));
  console.log('  suggest                Get suggestions');
  console.log('  predict:next           Predict next action');
  console.log('  help                   Show this help');
  console.log('  clear                  Clear screen');
  console.log('  exit                   Exit interactive mode\n');
}

// ═══════════════════════════════════════════════════════════
// ░░ MAIN ░░
// ═══════════════════════════════════════════════════════════

cli.parse();
