import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { VirtualShell } from '../../arbiters/VirtualShell.js';
import { guardSomaText } from '../context/GroundedReasoning.js';
import identity from '../services/GMNIdentity.js';

// Convert module.exports = function(context) { ... } to export default function(context) { ... }

export default function (context) {
  const router = express.Router();
  const { quadBrain, goalPlanner, pulseArbiter, contextManager, astIndexer } = context;

  // Initialize persistent VirtualShell for this session
  if (!context.virtualShell) {
      context.virtualShell = new VirtualShell();
  }
  const shell = context.virtualShell;

  // Middleware to ensure components are ready
  const ensureReady = (component, name) => (req, res, next) => {
    if (!component) {
      return res.status(503).json({ success: false, error: `${name} not initialized` });
    }
    next();
  };

  // ═══════════════════════════════════════════════════════════
  // PLANNING ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  router.post('/arbiter/generate-plan', ensureReady(quadBrain, 'QuadBrain'), async (req, res) => {
    try {
      const { goal, context } = req.body;
      if (!goal) return res.status(400).json({ error: 'Goal is required' });

      console.log(`[PulseRoutes] Generating plan for: "${goal}"`);

      const prompt = `You are an expert strategic planner.
User Goal: "${goal}"
Context: ${JSON.stringify(context || {})}

Create a detailed, step-by-step execution plan.
Return ONLY valid JSON in this format:
{
  "summary": "Brief overview of the approach",
  "reasoning": "Why this approach was chosen",
  "totalEstimate": "e.g. 2 hours",
  "arbitersUsed": ["List", "Relevant", "Arbiters"],
  "steps": [
    {
      "id": "step-1",
      "title": "Step Title",
      "description": "Detailed instructions",
      "complexity": "low|medium|high",
      "estimate": "e.g. 30m",
      "dependencies": [],
      "arbiterSuggestion": "SpecificArbiterName"
    }
  ]
}`;

      const response = await quadBrain.reason(prompt, {
        brain: 'PROMETHEUS', // Strategic brain
        temperature: 0.2
      });

      // Parse JSON from response (handle markdown blocks if present)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Failed to parse JSON from QuadBrain response");

      const plan = JSON.parse(jsonMatch[0]);

      // Optionally track in GoalPlanner if available
      if (goalPlanner) {
        try {
          const goalId = await goalPlanner.createGoal({
            title: goal,
            category: 'user_requested',
            description: plan.summary,
            metadata: { plan }
          });
          plan.planId = goalId.goalId; // Attach ID to response
        } catch (e) {
          console.warn("[PulseRoutes] Failed to track goal in GoalPlanner:", e.message);
        }
      }

      res.json({ success: true, ...plan });

    } catch (error) {
      console.error('[PulseRoutes] Plan generation error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/arbiter/plan/:planId', ensureReady(pulseArbiter, 'PulseArbiter'), async (req, res) => {
    try {
      const { planId } = req.params;
      const plan = await pulseArbiter.loadPlanFromContext(planId);
      if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
      res.json({ success: true, plan });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/arbiter/plan/:planId/results', ensureReady(pulseArbiter, 'PulseArbiter'), async (req, res) => {
    try {
      const { planId } = req.params;
      await pulseArbiter.updatePlanWithResults(planId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // FILE SYSTEM ENDPOINTS (REAL)
  // ═══════════════════════════════════════════════════════════

  // Helper to safely resolve paths
  const safeResolve = (targetPath) => {
    const root = process.cwd();
    const resolved = path.resolve(root, targetPath || '.');
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error("Access denied: Path outside workspace");
    }
    return resolved;
  };

  router.post('/fs/create-dir', async (req, res) => {
    try {
      const { path: dirPath } = req.body;
      const resolved = safeResolve(dirPath);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      res.json({ success: true, path: resolved });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/fs/read-file', async (req, res) => {
    try {
      const filePath = req.body.path || req.body.filePath || req.body.sourcePath;
      if (!filePath) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }
      const resolved = safeResolve(filePath);

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }

      const content = fs.readFileSync(resolved, 'utf8');
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/fs/write-file', async (req, res) => {
    try {
      const filePath = req.body.path || req.body.filePath || req.body.sourcePath;
      if (!filePath) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }
      const { content } = req.body;
      const resolved = safeResolve(filePath);

      // Ensure dir exists
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content || '', 'utf8');

      res.json({ success: true, path: resolved });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/fs/list', async (req, res) => {
    try {
      const { path: dirPath } = req.body;
      const resolved = safeResolve(dirPath || '.');

      const files = fs.readdirSync(resolved, { withFileTypes: true }).map(dirent => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        path: path.join(dirPath || '.', dirent.name)
      }));

      res.json({ success: true, files });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  const handleListTree = (req, res) => {
    try {
      const dirPath = req.query.dir || req.body.path || req.body.dir || '.';
      const resolved = safeResolve(dirPath);

      const getDirectoryTree = (currentPath) => {
        const currentResolved = safeResolve(currentPath);
        const entries = fs.readdirSync(currentResolved, { withFileTypes: true });

        return entries.map(dirent => {
          if (dirent.name.startsWith('.') && dirent.name !== '.env') {
            return null;
          }

          const childRelPath = path.join(currentPath, dirent.name).replace(/\\/g, '/');
          const isDirectory = dirent.isDirectory();

          // Exclude large models, build folders, dependency caches, and system structures
          if ([
            '.git', 'node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__',
            'models', 'data/models', 'llama.cpp'
          ].includes(dirent.name) || 
            childRelPath.includes('data/models') || 
            childRelPath.includes('llama.cpp/build')) {
            return null;
          }

          const node = {
            name: dirent.name,
            isDir: isDirectory,
            path: childRelPath
          };

          if (isDirectory) {
            node.children = getDirectoryTree(childRelPath);
          }

          return node;
        }).filter(Boolean);
      };

      const files = getDirectoryTree(dirPath);
      res.json({ success: true, files });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  };

  router.get('/fs/list-tree', handleListTree);
  router.post('/fs/list-tree', handleListTree);

  router.get('/fs/raw', async (req, res) => {
    try {
      const filePath = req.query.path || req.query.filePath;
      if (!filePath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }
      const resolved = safeResolve(filePath);

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: 'File not found' });
      }

      res.sendFile(resolved);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // WORKSPACE & CONTEXT
  // ═══════════════════════════════════════════════════════════

  router.post('/workspace/save', ensureReady(contextManager, 'ContextManager'), async (req, res) => {
    try {
      const { workspaceId, workspace } = req.body;
      await contextManager.saveProject(workspaceId, workspace);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/workspace/load', ensureReady(contextManager, 'ContextManager'), async (req, res) => {
    try {
      const { workspaceId } = req.body;
      const result = await contextManager.loadProject(workspaceId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SYSTEM & SHELL
  // ═══════════════════════════════════════════════════════════

  router.post('/shell/execute', async (req, res) => {
    try {
      const { command, timeout } = req.body;
      
      console.log(`[PulseShell] Executing: "${command}" (CWD: ${shell.cwd})`);
      const result = await shell.execute(command, timeout || 15000);
      
      res.json({
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
        error: result.stderr || null,
        code: result.exitCode,
        cwd: result.cwd
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // STEVE ASSIST (Real Agentic Endpoint)
  // ═══════════════════════════════════════════════════════════

  router.post('/arbiter/steve-assist', async (req, res) => {
    // We access steveArbiter from context directly here since it might be initialized late
    const steveArbiter = context.steveArbiter;

    if (!steveArbiter) {
      return res.status(503).json({ success: false, error: 'SteveArbiter not initialized' });
    }

    const abortController = new AbortController();
    const onReqClose = () => {
      if (res.writableEnded) return;
      console.log('[PulseRoutes] Connection closed prematurely, aborting Steve Assist...');
      abortController.abort();
    };
    res.on('close', onReqClose);
    const cleanup = () => { res.off('close', onReqClose); };

    try {
      const { message, history, context: chatContext } = req.body;
      const wantsStream = chatContext?.stream === true || req.query.stream === 'true';

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const sendSSE = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
        const onToken = (token) => sendSSE({ token });
        const onPhase = (phase, details) => sendSSE({ type: 'phase', phase, details });

        const result = await steveArbiter.processChat(message, history, { ...chatContext, onToken, onPhase, signal: abortController.signal });
        if (typeof result?.response === 'string') {
          const guarded = await guardSomaText(result.response, message || '');
          result.response = guarded.text || result.response;
        }
        sendSSE({ done: true, success: true, ...result, arbitersConsulted: ['SteveArbiter', 'SOMArbiterV3'], agenticMode: true });
        res.end();
      } else {
        // Call Steve's real brain
        // Now returns structured JSON: { response, actions, updatedFiles }
        const result = await steveArbiter.processChat(message, history, { ...chatContext, signal: abortController.signal });
        if (typeof result?.response === 'string') {
          const guarded = await guardSomaText(result.response, message || '');
          result.response = guarded.text || result.response;
        }

        res.json({
          success: true,
          ...result, // Spread the structured result (response, actions, updatedFiles)
          arbitersConsulted: ['SteveArbiter', 'SOMArbiterV3'],
          agenticMode: true
        });
      }
    } catch (error) {
      console.error('[PulseRoutes] Steve assist error:', error);
      if (res.headersSent) {
        if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`); res.end(); }
      } else {
        res.status(500).json({ success: false, error: error.message });
      }
    } finally {
      cleanup();
    }
  });

  router.post('/steve/create-tool', async (req, res) => {
    const steveArbiter = context.steveArbiter;
    if (!steveArbiter) return res.status(503).json({ error: 'SteveArbiter not initialized' });

    try {
      const { description, context: toolContext } = req.body;
      const result = await steveArbiter.createToolFromDescription(description, toolContext);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/steve/tools', async (req, res) => {
    const steveArbiter = context.steveArbiter;
    if (!steveArbiter) return res.status(503).json({ error: 'SteveArbiter not initialized' });

    try {
      const { category } = req.query;
      const tools = steveArbiter.listTools(category);
      res.json({ success: true, tools });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/steve/execute-tool', async (req, res) => {
    const steveArbiter = context.steveArbiter;
    if (!steveArbiter) return res.status(503).json({ error: 'SteveArbiter not initialized' });

    try {
      const { toolName, parameters, context: execContext } = req.body;
      const result = await steveArbiter.executeTool(toolName, parameters, execContext);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SMART TERMINAL
  // ═══════════════════════════════════════════════════════════

  router.post('/terminal/translate', async (req, res) => {
    const steveArbiter = context.steveArbiter;
    if (!steveArbiter) return res.status(503).json({ error: 'SteveArbiter not initialized' });
    try {
      const { prompt } = req.body;
      const sysMsg = "You are a shell command translator. Translate the natural language request into a single Windows PowerShell or shell command. Return ONLY the raw command. NO markdown formatting, NO explanation, NO backticks. If you cannot translate it, return an empty string.";
      const result = await steveArbiter.processChat(
        { role: 'user', content: prompt },
        [{ role: 'system', content: sysMsg }],
        { stream: false, autonomous: true }
      );
      
      let cmd = result.response || '';
      // Strip markdown code blocks if the LLM adds them despite instructions
      cmd = cmd.replace(/^```[a-z]*\n?/im, '').replace(/```$/im, '').trim();
      
      res.json({ success: true, command: cmd });
    } catch (error) {
      console.error('[PulseRoutes] terminal translate error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ANALYSIS & WORKFLOW (Forward to PulseArbiter)
  // ═══════════════════════════════════════════════════════════

  router.post('/arbiter/analyze-preview', ensureReady(pulseArbiter, 'PulseArbiter'), async (req, res) => {
    try {
      const result = await pulseArbiter.handleMessage({
        type: 'analyze_preview',
        payload: req.body
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/arbiter/analyze-element', ensureReady(pulseArbiter, 'PulseArbiter'), async (req, res) => {
    try {
      const result = await pulseArbiter.handleMessage({
        type: 'analyze_element',
        payload: req.body
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/workflow/execute', ensureReady(pulseArbiter, 'PulseArbiter'), async (req, res) => {
    try {
      // Placeholder for workflow execution logic
      res.json({ success: true, message: 'Workflow execution not yet fully implemented in PulseRoutes' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // AGENTIC LOOPS (Self-Healing & Learning)
  // ═══════════════════════════════════════════════════════════

  router.post('/arbiter/modify-code', async (req, res) => {
    try {
      const { filepath, request, context: modifyContext } = req.body;
      const { nemesis } = context;

      if (!filepath || !request) {
        return res.status(400).json({ success: false, error: 'filepath and request are required' });
      }

      const resolvedPath = safeResolve(filepath);

      // 1. Nemesis Code Gate (Critique)
      if (nemesis && modifyContext?.healing) {
        console.log(`[PulseRoutes] 🛡️ Routing auto-fix through NemesisArbiter for ${filepath}...`);
        
        try {
          const evalResult = await nemesis.evaluate(resolvedPath, request, "Self-Healing Auto-Fix");
          
          if (evalResult && evalResult.score < 0.70) {
            console.warn(`[PulseRoutes] ❌ Nemesis rejected the auto-fix (Score: ${evalResult.score}). Reason: ${evalResult.critique}`);
            return res.status(406).json({ 
              success: false, 
              error: 'NemesisArbiter rejected the proposed fix for safety or quality reasons.',
              critique: evalResult.critique
            });
          }
          
          console.log(`[PulseRoutes] ✅ Nemesis approved the auto-fix (Score: ${evalResult.score}).`);
        } catch (evalError) {
          console.warn(`[PulseRoutes] ⚠️ Nemesis evaluation failed, proceeding with caution:`, evalError.message);
        }
      }

      // 2. Apply Fix
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, request, 'utf8');

      res.json({ success: true, path: resolvedPath });
    } catch (error) {
      console.error('[PulseRoutes] modify-code error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/learning/record', async (req, res) => {
    try {
      const { messageBroker } = context;
      if (!messageBroker) {
        return res.status(503).json({ success: false, error: 'MessageBroker not initialized' });
      }

      const { type, success, data, fix, source } = req.body;
      
      console.log(`[PulseRoutes] 🧠 Recording learning event from ${source || 'unknown'} (${type})`);

      // Publish to Universal Learning Pipeline (DistillationArbiter listens to this)
      messageBroker.publish('learning_ready', {
        experiences: [{
          action: type,
          reward: success ? 1 : -1,
          outcome: data || fix,
          agent: source || 'SelfHealingEngine'
        }],
        outcomes: [success ? 'success' : 'failure'],
        stats: { recordedAt: Date.now() }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('[PulseRoutes] learning/record error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // AST CODEBASE INDEXING & BLAST RADIUS
  // ═══════════════════════════════════════════════════════════

  router.post('/ast/reindex', async (req, res) => {
    if (!astIndexer) {
      return res.status(503).json({ success: false, error: 'ASTIndexerService not initialized' });
    }
    try {
      console.log('[PulseRoutes] Triggering manual AST re-indexing...');
      astIndexer.startIndexing();
      res.json({ success: true, message: 'AST indexing started in background' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/vector-search', async (req, res) => {
    const vectorSearch = context.vectorSearch;
    if (!vectorSearch || !vectorSearch.isReady) {
      return res.status(503).json({ success: false, error: 'VectorSearchService not initialized or not ready' });
    }
    try {
      const { query, limit } = req.query;
      if (!query) return res.status(400).json({ success: false, error: 'Query required' });
      const results = await vectorSearch.search(query, parseInt(limit) || 5);
      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/ast/symbols', async (req, res) => {
    if (!astIndexer) {
      return res.status(503).json({ success: false, error: 'ASTIndexerService not initialized' });
    }
    try {
      const { query, limit, type } = req.query;
      const symbols = astIndexer.searchSymbols(query || '', parseInt(limit) || 50, type);
      res.json({ success: true, symbols });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/ast/types/trace', async (req, res) => {
    if (!astIndexer) {
      return res.status(503).json({ success: false, error: 'ASTIndexerService not initialized' });
    }
    try {
      const { typeName } = req.query;
      if (!typeName) return res.status(400).json({ success: false, error: 'typeName required' });
      const result = astIndexer.traceTypeDependencies(typeName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ast/blast-radius', async (req, res) => {
    if (!astIndexer) {
      return res.status(503).json({ success: false, error: 'ASTIndexerService not initialized' });
    }
    try {
      const { filePaths, filePath } = req.body;
      const targetPaths = filePaths || (filePath ? [filePath] : []);
      if (targetPaths.length === 0) {
        return res.status(400).json({ success: false, error: 'filePath or filePaths is required' });
      }
      
      const result = astIndexer.computeBlastRadius(targetPaths);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/export-gmn', async (req, res) => {
    try {
      const { siteName, html } = req.body;
      if (!siteName || !html) {
        return res.status(400).json({ success: false, error: 'siteName and html are required' });
      }

      // Cryptographically sign the HTML using the Node's Ed25519 identity
      const signature = identity.sign(html);
      const publicKey = identity.getPublicKeyHex();
      
      const artifact = {
        version: 1,
        alg: 'ed25519',
        siteName,
        html,
        signature,
        publicKey,
        createdAt: new Date().toISOString()
      };

      const exportDir = path.resolve(process.cwd(), 'data', 'pulse', 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const artifactPath = path.join(exportDir, `${siteName}.gmn-artifact`);
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

      res.json({ success: true, artifactPath, signature });
    } catch (error) {
      console.error('[Pulse Export] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
