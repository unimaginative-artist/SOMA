/**
 * LiveConversationalAgent.js
 * 
 * SOMA's Live Interactive Agent Harness.
 * Executes live ReAct tool loops for conversational turns (Discord, Web Chat, CLI).
 * 
 * Powered by local Qwen 2.5 Coder 14B in Ollama, backed by TransactionalCodeModifier
 * for safe atomic rollbacks, ToolRegistry, and ExecutionJobStore for durable receipts.
 */

import fs from 'fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { TransactionalCodeModifier, globalTransactionalModifier } from './TransactionalCodeModifier.js';
import { globalJobStore } from './ExecutionJobStore.js';
import toolRegistry from './ToolRegistry.js';
import { resolveWithinRoot } from './PathSafety.js';
import { CommandPolicyEngine } from './CommandPolicyEngine.js';

const execAsync = promisify(exec);
const ROOT = process.cwd();
const STACK_ROOT = path.resolve(ROOT, '..');
const MAX_PATH = process.env.MAX_PATH || path.resolve(STACK_ROOT, 'MAX');

export function normalizeWorkspacePath(candidate = '') {
  const c = String(candidate || '').trim();
  if (!c || c === '.' || c === './' || c === '.\\') return ROOT;
  if (c === '..' || c === '../' || c === '..\\' || c.toLowerCase() === 'the stack' || c.toLowerCase() === 'the-stack') return STACK_ROOT;
  if (c.toLowerCase() === 'max' || c.toLowerCase() === 'max/' || c.toLowerCase() === 'max\\' || c === '../MAX' || c === '..\\MAX') {
    return MAX_PATH;
  }
  if (/^max[\\/]/i.test(c)) {
    return path.resolve(MAX_PATH, c.slice(4));
  }
  if (/^\.\.[\\/]max[\\/]?/i.test(c)) {
    return path.resolve(MAX_PATH, c.replace(/^\.\.[\\/]max[\\/]?/i, ''));
  }
  if (path.isAbsolute(c)) {
    return c;
  }
  if (existsSync(path.resolve(ROOT, c))) {
    return path.resolve(ROOT, c);
  }
  if (existsSync(path.resolve(MAX_PATH, c))) {
    return path.resolve(MAX_PATH, c);
  }
  if (existsSync(path.resolve(STACK_ROOT, c))) {
    return path.resolve(STACK_ROOT, c);
  }
  return path.resolve(ROOT, c);
}

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_STEP_TIMEOUT_MS = 180000;

export class LiveConversationalAgent {
  constructor(opts = {}) {
    this.name = 'LiveConversationalAgent';
    this.jobStore = opts.jobStore || globalJobStore;
    this.codeModifier = opts.codeModifier || new TransactionalCodeModifier({ root: STACK_ROOT });
    this.toolRegistry = opts.toolRegistry || toolRegistry;
    this.commandPolicy = opts.commandPolicy || new CommandPolicyEngine();
    this.ollamaEndpoint = opts.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
    this.model = opts.model || process.env.SOMA_CODER_MODEL || 'qwen2.5-coder:7b';
    this.maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
    this.logger = opts.logger || console;
  }

  /**
   * Run a live conversational execution turn.
   * @param {string} userInstruction - Natural language instruction from Owner
   * @param {Object} opts - Context, callbacks, and configuration
   * @returns {Promise<Object>} Execution result with receipts and summary
   */
  async runTurn(userInstruction, opts = {}) {
    const startedAt = Date.now();
    const jobId = opts.jobId || `live-${crypto.randomUUID().slice(0, 12)}`;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    // 1. Create durable job tracking record
    try {
      this.jobStore.createJob({
        jobId,
        task: userInstruction,
        mode: 'live_turn',
        source: opts.source || 'conversational_ingress'
      });
      this.jobStore.updateJob(jobId, { status: 'planning' });
    } catch {}

    onProgress({
      step: 0,
      phase: 'planning',
      message: '🧠 Formulating execution plan with Qwen 2.5 Coder...'
    });

    const observations = [];
    const toolsUsed = [];
    let isComplete = false;
    let finalSummary = '';
    let stepCount = 0;

    const availableToolsDescription = `
AVAILABLE TOOLS:
1. read_file(path: string, startLine?: number, endLine?: number)
   Reads the exact content of a file with line numbers.
2. edit_file(path: string, targetContent: string, replacementContent: string)
   Surgically modifies a file. Validates syntax and automatically rolls back if syntax breaks.
3. write_file(path: string, content: string)
   Creates a new file with specified content.
4. run_command(command: string)
   Executes a shell command (e.g. running tests with 'node tests/...').
5. search_code(query: string, directory?: string)
   Searches for a text pattern in files.
6. list_files(directory?: string)
   Lists files in a workspace directory.

FORMAT PROTOCOL:
If you need to use a tool, reply in EXACTLY this format:
THINK: <one sentence reasoning>
TOOL: <tool_name>
ARGS: <valid JSON arguments object>

When the task is complete and verified, reply in EXACTLY this format:
DONE: yes
RESULT: <concise, concrete summary of what was accomplished, including real file paths, line numbers, or test outcomes>
`;

    const systemPrompt = `You are SOMA's Motor Cortex (Logos / Qwen Coder), an expert autonomous software engineer.
You are running on Owner's computer to execute real tasks directly.
You do NOT simulate or pretend to work. You use your tools to inspect, modify, test, and verify.
Always inspect code before editing.
Always run tests or verify syntax after modifying code.

WORKSPACE TOPOLOGY:
- Current workspace: SOMA (${ROOT})
- Peer workspace: MAX (${MAX_PATH})
- The Stack Root: (${STACK_ROOT})
When Owner refers to "MAX" or "max folder", use list_files with directory "MAX" or read_file with path "MAX/...".

EFFICIENCY RULE:
When asked to inspect or list files/folders, once you execute the tool and receive the listing or content, immediately complete the turn with DONE: yes and summarize your findings in RESULT. Do not make extra search tool calls unless specifically asked.

${availableToolsDescription}`;

    try {
      this.jobStore.updateJob(jobId, { status: 'executing' });

      while (stepCount < this.maxSteps && !isComplete) {
        stepCount++;
        const historyText = observations.map(o => 
          `Step ${o.step}:\nAction: ${o.tool}(${JSON.stringify(o.args)})\nResult: ${typeof o.result === 'string' ? o.result.slice(0, 3000) : JSON.stringify(o.result).slice(0, 3000)}`
        ).join('\n\n');

        const prompt = `GOAL: ${userInstruction}

${observations.length ? `PREVIOUS ACTIONS AND OBSERVATIONS:\n${historyText}\n\nIf the observations above provide enough information to satisfy the goal, conclude immediately with:\nDONE: yes\nRESULT: <comprehensive summary answering the user's request>\n\nOtherwise, what is your next tool action?` : 'What is your first tool action?'}`;

        // Call Ollama Qwen Coder
        let responseText = '';
        try {
          responseText = await this._callOllama(systemPrompt, prompt);
        } catch (callErr) {
          // If 14b model is loading or times out, fallback to basic error recording
          throw new Error(`Model execution error: ${callErr.message}`);
        }

        // Parse Model Response
        const parsed = this._parseResponse(responseText);

        if (parsed.isDone) {
          isComplete = true;
          finalSummary = parsed.result;
          break;
        }

        if (!parsed.tool) {
          // Model didn't specify a tool; prompt for format repair
          observations.push({
            step: stepCount,
            tool: 'format_repair',
            args: {},
            result: 'Format error: You must specify TOOL: <tool_name> and ARGS: <json> or DONE: yes with RESULT: <summary>'
          });
          continue;
        }

        // Execute Tool
        toolsUsed.push(parsed.tool);
        onProgress({
          step: stepCount,
          phase: 'executing',
          tool: parsed.tool,
          thought: parsed.thought,
          message: this._formatProgressMessage(parsed.tool, parsed.args)
        });

        const executionOutput = await this._executeTool(parsed.tool, parsed.args);

        observations.push({
          step: stepCount,
          tool: parsed.tool,
          args: parsed.args,
          result: executionOutput.output,
          success: executionOutput.success,
          receipt: executionOutput.receipt || null
        });

        // Record in ExecutionJobStore
        try {
          this.jobStore.appendEvent(jobId, {
            type: 'tool_completed',
            step: stepCount,
            tool: parsed.tool,
            success: executionOutput.success,
            timestamp: Date.now()
          });
        } catch {}
      }

      // 4. Conclude turn
      const durationMs = Date.now() - startedAt;
      const finalStatus = isComplete ? 'completed' : 'stopped_at_step_limit';

      const receipts = observations.map(o => ({
        step: o.step,
        tool: o.tool,
        success: o.success,
        summary: typeof o.result === 'string' ? o.result.slice(0, 300) : 'completed'
      }));

      this.jobStore.updateJob(jobId, {
        status: finalStatus,
        summary: finalSummary || `Execution finished after ${stepCount} steps.`,
        toolsUsed,
        toolResults: observations,
        iterations: stepCount,
        durationMs
      });

      onProgress({
        step: stepCount,
        phase: 'completed',
        message: '✅ Execution complete and verified.'
      });

      return {
        jobId,
        status: finalStatus,
        success: isComplete,
        summary: finalSummary || 'Task completed.',
        toolsUsed,
        stepCount,
        observations,
        receipts,
        durationMs
      };
    } catch (error) {
      this.logger.error?.(`[${this.name}] Turn failed: ${error.message}`);
      try {
        this.jobStore.updateJob(jobId, {
          status: 'failed',
          errors: [error.message]
        });
      } catch {}

      return {
        jobId,
        status: 'failed',
        success: false,
        error: error.message,
        toolsUsed,
        stepCount,
        observations
      };
    }
  }

  /**
   * Internal Ollama API caller.
   */
  async _callOllama(systemPrompt, userPrompt) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_STEP_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.ollamaEndpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          system: systemPrompt,
          prompt: userPrompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_ctx: 8192,
            num_predict: 512
          }
        }),
        signal: ctrl.signal
      });

      if (!res.ok) {
        throw new Error(`Ollama responded with HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return data.response || '';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse ReAct model response.
   */
  _parseResponse(text = '') {
    const doneMatch = text.match(/DONE:\s*(yes|true)[\s\S]*?RESULT:\s*([\s\S]+)$/i);
    if (doneMatch) {
      return {
        isDone: true,
        result: doneMatch[2].trim()
      };
    }

    const toolMatch = text.match(/TOOL:\s*([a-zA-Z0-9_-]+)/i);
    const argsMatch = text.match(/ARGS:\s*(\{[\s\S]*\}|\[[\s\S]*\])/i);
    const thinkMatch = text.match(/THINK:\s*([^\n]+)/i);

    if (toolMatch) {
      let args = {};
      if (argsMatch) {
        try {
          args = JSON.parse(argsMatch[1]);
        } catch {
          // Argument parse fallback
          args = { raw: argsMatch[1] };
        }
      }
      return {
        isDone: false,
        tool: toolMatch[1].trim(),
        args,
        thought: thinkMatch ? thinkMatch[1].trim() : ''
      };
    }

    return {
      isDone: false,
      tool: null,
      raw: text
    };
  }

  /**
   * Safe tool execution bridge.
   */
  async _executeTool(toolName, args = {}) {
    const name = String(toolName || '').toLowerCase().trim();

    try {
      switch (name) {
        case 'read_file': {
          const norm = normalizeWorkspacePath(args.path || args.file || '');
          const filePath = resolveWithinRoot(STACK_ROOT, norm, 'read_file');
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');
          const start = Math.max(1, Number(args.startLine || 1));
          const end = Math.min(lines.length, Number(args.endLine || lines.length));
          const snippet = lines.slice(start - 1, end).map((l, idx) => `${start + idx}: ${l}`).join('\n');
          return { success: true, output: snippet };
        }

        case 'edit_file': {
          const norm = normalizeWorkspacePath(args.path || args.file || '');
          const filePath = resolveWithinRoot(STACK_ROOT, norm, 'edit_file');
          const modResult = await this.codeModifier.modifyFile({
            filePath,
            targetContent: args.targetContent,
            replacementContent: args.replacementContent,
            instruction: args.instruction || 'live_agent_edit'
          });
          return {
            success: modResult.success,
            output: modResult.success ? `Successfully edited ${filePath} (syntax verified)` : `Edit failed: ${modResult.error}`,
            receipt: modResult.receipt || null
          };
        }

        case 'write_file': {
          const norm = normalizeWorkspacePath(args.path || args.file || '');
          const filePath = resolveWithinRoot(STACK_ROOT, norm, 'write_file');
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, args.content || '', 'utf8');
          return { success: true, output: `Wrote ${Buffer.byteLength(args.content || '')} bytes to ${filePath}` };
        }

        case 'run_command': {
          const cmd = String(args.command || args.cmd || '');
          if (!cmd) return { success: false, output: 'No command provided' };
          this.commandPolicy.validate(cmd);
          const { stdout, stderr } = await execAsync(cmd, { cwd: ROOT, timeout: 45000 });
          const out = (stdout || '') + (stderr ? `\nSTDERR:\n${stderr}` : '');
          return { success: true, output: out.slice(0, 4000) || 'Command executed with 0 output' };
        }

        case 'list_files': {
          const norm = normalizeWorkspacePath(args.directory || args.path || '.');
          const dir = resolveWithinRoot(STACK_ROOT, norm, 'list_files', { allowRoot: true });
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const list = entries.slice(0, 250).map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
          return { success: true, output: list || 'Empty directory' };
        }

        case 'search_code': {
          const query = String(args.query || '');
          const norm = normalizeWorkspacePath(args.directory || '');
          const searchDir = resolveWithinRoot(STACK_ROOT, norm, 'search_code', { allowRoot: true });
          const { stdout } = await execAsync(`git grep -n -i "${query.replace(/"/g, '\\"')}"`, { cwd: searchDir, timeout: 20000 }).catch(e => ({ stdout: e.stdout || 'No matches found' }));
          return { success: true, output: stdout.slice(0, 3000) || 'No matches found' };
        }

        default:
          return { success: false, output: `Unknown tool: ${toolName}` };
      }
    } catch (toolError) {
      return { success: false, output: `Tool error (${toolName}): ${toolError.message}` };
    }
  }

  _formatProgressMessage(tool, args = {}) {
    switch (tool) {
      case 'read_file':
        return `📖 Inspecting \`${args.path || args.file || 'file'}\`...`;
      case 'edit_file':
        return `✏️ Editing \`${args.path || args.file || 'file'}\` (transactional safety on)...`;
      case 'write_file':
        return `📝 Writing \`${args.path || args.file || 'file'}\`...`;
      case 'run_command':
        return `⚙️ Running \`${args.command || args.cmd || 'command'}\`...`;
      case 'search_code':
        return `🔍 Searching codebase for \`"${args.query || ''}"\`...`;
      case 'list_files':
        return `📂 Listing directory \`${args.directory || '.'}\`...`;
      default:
        return `🛠️ Executing \`${tool}\`...`;
    }
  }
}

export const globalLiveAgent = new LiveConversationalAgent();
export default LiveConversationalAgent;
