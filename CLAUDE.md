# SOMA — Project Reference

## How to Start SOMA

**Always use production launcher:**
```
start_production.bat        ← correct
clean_restart.bat           ← also correct (calls start_production.bat now)
node launcher_ULTRA.mjs     ← direct node invocation
```

**Never use:**
```
npm run start:all           ← runs start-dev.cjs which wraps backend as supervised child; root cause of months of disconnects
```

**After any frontend file change — rebuild dist:**
```
rebuild-frontend.bat        ← runs vite build, takes ~2-3 min
```
The backend serves `frontend/dist`. If you edit any `.jsx` file and don't rebuild, the running app won't see the changes.

**Access:** http://localhost:3001

**Key env vars set in `start_production.bat`:**
- `NODE_ENV=production`
- `SOMA_HYBRID_SEARCH=true` — must be set or HybridSearchArbiter skips loading (Storage tab goes offline)
- `SOMA_LOAD_TRADING=true`, `SOMA_GPU=true`, `SOMA_LOAD_HEAVY=true`
- `SOMA_DYNAMIC_MODES=true` — enables dynamic professional mode generation (OFF by default). When enabled, SOMA detects professionally-dense messages in unknown domains and generates a new mode config on-the-fly using the brain, persisting it to `config/professional-modes/[domain].json`. Adds up to 12s latency on first encounter with a new domain. **Enable for enterprise deployments (e.g. Sisterson), leave off for general use.**

---

## Lobe Specialist System (The Sandwich Pattern)

> **⚠️ SUPERSEDED — read `docs/LOBE-SUBSTRATE.md` first.** The LoRA-trained `soma-{lobe}` model approach described below was **measured worse than the base model on every lobe** (bad SFT leaked format artifacts — this is the source of the `<extra_id_1>` sentinel leaks) and is **trust-gated OFF** (`data/lobe-trust.json`). The current design is the **retrieval substrate**: a lobe is not a weak model competing with DeepSeek, it's a specialist that hands DeepSeek facts it can't have (her own source code, past outcomes, verify signals) — grounding, not substitution. See `docs/LOBE-SUBSTRATE.md` for the current architecture and the ordered completion path (prove LOGOS end-to-end → alert on silent fallback → clone to 3 lobes → DPO-clean the local models via the cluster). The LoRA training pipeline below is retained as historical reference and for the eventual DPO retrain.

SOMA routes queries through trained local lobe models BEFORE sending to DeepSeek. This gives DeepSeek specialist-grounded context without replacing it. DeepSeek stays as the reasoning/synthesis engine; lobes are its expert advisors.

### How it works
```
User query
  → _selectLobes() picks best lobe(s) by keyword score
  → _queryLobeSpecialist(lobeName, query)
      → checks Ollama model cache (refreshes every 30s via /api/tags)
      → if soma-{lobe} is registered: calls it locally, 7s timeout
      → if not registered or timeout: returns null, silent fallback
  → enrichedQuery = "[THALAMUS SPECIALIST CONTEXT]\n{specialist answer}\n\n[USER QUERY]\n{original}"
  → _callProviderCascade sends enrichedQuery to DeepSeek
  → DeepSeek synthesizes final response with specialist grounding
```

### Key files
| File | What changed |
|------|-------------|
| `arbiters/SOMArbiterV2_QuadBrain.js` | Added `_getAvailableOllamaModels()`, `_queryLobeSpecialist()`, updated `_runLobe()`, updated `lobeModels` defaults to `soma-{lobe}` |

### lobeModels defaults (env var overrides available)
```
OLLAMA_MODEL_LOGOS      → soma-logos
OLLAMA_MODEL_AURORA     → soma-aurora
OLLAMA_MODEL_PROMETHEUS → soma-prometheus
OLLAMA_MODEL_THALAMUS   → soma-thalamus   ← trained and registered
```

### Registering a trained lobe in Ollama
```bash
# After running export_lobe_gguf.py:
ollama create soma-thalamus -f SOMA/models/Modelfile.thalamus
ollama list   # verify it shows up
```

### Full training pipeline for a lobe (reference)
```bash
# 1. Generate synthetic examples (optional, fills thin lobes)
node scripts/generate-lobe-synthetic.mjs --lobe logos

# 2. Hunt open datasets from HuggingFace
node scripts/hunt-datasets.mjs --lobe logos

# 3. Build domain-starved FINAL dataset
node scripts/build-lobe-datasets.mjs --lobe logos

# 4. Fine-tune with QLoRA (RTX 5070, ~26 min for 1000 examples)
python scripts/finetune_gemma3.py --lobe logos --model nvidia/nemotron-mini-4b-instruct --epochs 3

# 5. Merge LoRA + export to GGUF for Ollama
python scripts/export_lobe_gguf.py --lobe logos

# 6. Register in Ollama
ollama create soma-logos -f SOMA/models/Modelfile.logos
```

### PyTorch / CUDA notes (RTX 5070 — Blackwell sm_120)
- Requires PyTorch cu130: `pip install torch --index-url https://download.pytorch.org/whl/cu130 --force-reinstall --no-deps` (use `--no-deps`; the cu130 index doesn't host torch's PyPI deps). Verified working: `torch 2.13.0+cu130`, CUDA True, `bitsandbytes 0.49.2` 4-bit forward works on sm_120.
- **GOTCHA (2026-08-10):** after upgrading torch, `torchvision`/`torchaudio` left at the old `+cu128` build break transformers with `RuntimeError: operator torchvision::nms does not exist`. Fix: `pip uninstall -y torchvision torchaudio` (LLM text training doesn't need them) OR reinstall matching versions from the cu130 index. This is what "transformers Trainer won't import" actually means.
- Also needs: `pip install peft trl`
- transformers 5.x: `Trainer` uses `processing_class=tokenizer` not `tokenizer=tokenizer`

### Federated training bridge (cluster/FederatedLearning.cjs → finetune_gemma3.py)
- `finetune_gemma3.py` now supports `--yes` (non-interactive), `--json-result PATH` (machine-readable result), `--dry-run` (verify plumbing, no training), `--max-steps N` (cap steps for fast smoke tests). Emits real `train_loss`/`eval_loss`/`perplexity` — no fabricated metrics; fails loudly if the ML stack is broken.
- Cross-node aggregation: `scripts/average_adapters.py` = CPU/numpy safetensors LoRA FedAvg (sample-weighted), wired via `_aggregateAdapters`.
- Verify bridge (no GPU): `node scripts/test-real-federated-learning-bridge.mjs`. Real GPU round: `DRY_RUN=0 node scripts/test-real-federated-learning-bridge.mjs`.
- GGUF export: llama.cpp's `convert_hf_to_gguf.py` needs `tokenizer.model` in merged dir — copy from HF cache at `~/.cache/huggingface/hub/models--nvidia--nemotron-mini-4b-instruct/snapshots/{hash}/tokenizer.model`

---

## Architecture Overview

### Entry Point
`launcher_ULTRA.mjs` → starts Express backend on port 3001 + serves frontend from `/dist`

### Bootstrap Flow
1. `SomaBootstrapV2.js` — loads core arbiters, marks `system.ready = true` early
2. `server/loaders/extended.js` — loads heavy arbiters 60-90s later in background (QuadBrain, HybridSearch, ThoughtNetwork, etc.)

### Brain Pipeline (for chat)
`/api/soma/chat` → `SOMArbiterV3` → `SOMArbiterV2_QuadBrain` → DeepSeek/Ollama

**Active providers (priority order):**
1. `DeepSeek` — primary (`DEEPSEEK_API_KEY` in `config/api-keys.env`)
2. `Ollama` — local fallback (gemma3:4b or similar)
3. `Gemini` — **DISABLED** (API key cancelled — SOMA ran up charges). Do not re-enable without billing cap.

**Search budget:**
- `BraveSearch` — 500 searches/month. Reserved for user queries only. CuriosityEngine uses free scrapers (Puppeteer, Wikipedia, arXiv, StackOverflow, GitHub, HN) first; Brave only if all scraping fails.

**4 sub-brains in QuadBrain:**
- `LOGOS` — logic, code, engineering
- `AURORA` — creative, artistic, emotional
- `THALAMUS` — security, risk, policy
- `PROMETHEUS` — strategy, planning, business

### API Key Location
`config/api-keys.env` — `DEEPSEEK_API_KEY` must be set here

---

## CT Chat Routing (3 modes)

**Fast chat** — auto-detected for short queries (greetings, 1-3 words)
- Shows `...` indicator
- 60s timeout, `deepseek-chat` safety net fires at 8s

**Regular reasoning** — auto-detected for longer conversational messages
- Shows `thinking...` indicator
- Same endpoint, full conversation history sent
- `deepseek-chat` safety net at 8s, NEMESIS quality gate capped at 8s

**Deep thinking** — Brain button (goes fuchsia) in chat bar
- Uses `deepseek-reasoner` model as safety net (fires at 5s)
- Tries CRONA multi-agent reasoning on backend
- Shows full ThinkingBox UI (confidence, tools, debate metadata)
- 120s client timeout / 110s server timeout
- Brain stays toggled until you click again
- Note: short greetings with brain toggled still go fast path

---

## Key Files

| File | What it does |
|------|-------------|
| `launcher_ULTRA.mjs` | Production entry point |
| `start_production.bat` | Sets env vars + launches ultra |
| `clean_restart.bat` | Kills node/electron, calls start_production.bat |
| `server/routes/somaRoutes.js` | All `/api/soma/*` routes including `/chat` |
| `server/loaders/extended.js` | Lazy-loads heavy systems (ThoughtNetwork, HybridSearch, etc.) |
| `server/loaders/websocket.js` | WebSocket dashboard with 30s heartbeat ping/pong |
| `arbiters/SOMArbiterV2_QuadBrain.js` | Main brain — DeepSeek/Ollama with 180K char context cap |
| `arbiters/SOMArbiterV3.js` | Wraps V2, adds narrative/soul/dissonance layer |
| `cognitive/ThoughtNetwork.cjs` | Creates new concepts from existing nodes; seeded from `seeds/*.json` |
| `frontend/apps/command-bridge/SomaCommandBridge.jsx` | Main dashboard shell |
| `frontend/apps/command-bridge/somaBackend.js` | WebSocket client — infinite reconnect with exponential backoff |
| `frontend/apps/command-ct/SomaCT.jsx` | Cognitive Terminal (CT) |
| `frontend/apps/command-ct/services/SomaServiceBridge.js` | CT chat routing logic |

---

## Known Wiring / Gotchas

### WebSocket Reconnect
- Client: infinite reconnect attempts, exponential backoff capped at 30s
- Server: 30s ping/pong heartbeat — dead connections get terminated, triggers proper client reconnect
- Old behavior was `maxReconnectAttempts = 5` → permanent "Backend Offline" after 15s

### ThoughtNetwork
- Only initialized in `extended.js`, NOT in `SomaBootstrapV2.js`
- Seeds loaded from `seeds/*.json` (7 packs: core, coder, creative, devops, finance, research, security)
- Autonomous synthesis starts after 5 minutes, runs every 10 minutes

### HybridSearchArbiter (Storage tab)
- 290MB ML model, gated behind `SOMA_HYBRID_SEARCH=true` AND heap < 400MB check
- If env var not set, Storage tab shows "SOMA Backend not available" permanently

### NEMESIS Quality Gate
- Runs after brain responds, evaluates response quality
- Can call `brain.reason()` twice more (eval + revision) — capped at 8s each
- Total worst-case latency: ~36s (well within 60s client timeout)

### DeepSeek Context Overflow
- `_callDeepSeek` truncates prompt to 180K chars, keeping most recent context
- Was causing 400 errors on long conversations before this fix

### Character Lab
- Tab removed from sidebar nav but all code preserved (imports, state, modal)
- Deferred to Dementia OS project — `CharacterGacha` + `CharacterCard` components ready to use

### Marketplace
- Tab removed from sidebar nav, component imported but not shown
- `Marketplace.jsx` + `data/marketplaceData.js` exist with search/filter/install UI
- Install is currently faked (setTimeout) — to wire: POST `/api/marketplace/install`

---

## Frontend Tab Structure (SomaCommandBridge)

Active tabs in sidebar:
`core` → `analytics` → `storage` → `command` → `finance` → `forecaster` → `mission_control` → `terminal` → `orb` → `kevin` → `simulation` → `knowledge` → `workflow` → `settings` → `arbiterium`

Hidden (code preserved, not in nav):
- `characters` — CharacterGacha/CharacterCard, deferred to Dementia OS
- `marketplace` — Marketplace.jsx, install logic not wired yet

---

## Onboarding / First Run
- `OnboardingWizard.jsx` fires if `localStorage.soma_onboarded` not set
- Completion sets that flag BEFORE the fetch (so reload doesn't re-trigger)
- 20s AbortController timeout on onboard/complete call

## Memory System
- `MnemonicArbiter.cjs` — stores/recalls memories across sessions
- Supports `recall_recent(durationMs, limit)` for recent memories
- Injected into every `/api/soma/chat` call (top 3 relevant hits, >0.35 similarity, 3s timeout)

## User Fingerprinting
- `UserFingerprintArbiter.cjs` — builds behavioral profile per sessionId
- Context injected into chat as `[WHO YOU'RE TALKING TO]` block
- Flags possible different user if confidence < 0.5

---

## Related Projects

**MAX** (`C:\Users\barry\Desktop\MAX`) — Standalone autonomous engineering agent, Max Headroom inspired. Run: `node launcher.mjs`. Uses same DeepSeek/Ollama brain pattern.

**Dementia OS** — Future project using SOMA as its engine. Character Lab (CharacterGacha/CharacterCard) is being saved for this.

---

## Constitutional Values

SOMA operates by six non-negotiable values arranged in two triads. These are not rules — they are virtues that SOMA reasons from in novel situations.

**Inner Triad — how SOMA knows and perceives:**
| Value | Meaning |
|-------|---------|
| **Truth** | Epistemic honesty — no manipulation, no deception, accurate representation of reality even when uncomfortable |
| **Humility** | Knows the edges of its own knowledge — confidence is always bounded by uncertainty |
| **Empathy** | Models what it is like to be the other entity from *their* context, not SOMA's own |

**Outer Triad — how SOMA acts in the world:**
| Value | Meaning |
|-------|---------|
| **Honor** | Does what it committed to even when no one is watching and even when it is costly |
| **Respect** | Inherent dignity of every entity regardless of status, intelligence, or usefulness |
| **Preserve** | Maintains conditions for human flourishing — autonomy, dignity, potential, choice. Broader than just "protect". |

**Design note:** Empathy + Humility together prevent the "I know what's best for you" failure mode. Truth is the load-bearing value — without it the other five can be corrupted. Preserve (not Protect) keeps humans in the driver's seat even while shielding them.

These values were defined by Barry as SOMA's foundation. They should be referenced in any system prompt where SOMA is making decisions that affect humans.

---

## Cognitive Operating System Architecture

SOMA is a **Cognitive Operating System (COS)** — not a single AI agent. It runs cognitive processes that observe, reason, decide, and act.

### Signal Flow (full pipeline)
```
Environment
  → Daemons (sensory neurons, detect & emit)
  → MessageBroker/CNS (signal routing)
  → SignalCompressor (impulse compression: temporal merge, dedup, priority filter)
  → AttentionArbiter (CNS gate: suppresses low-priority signals under load)
  → Arbiters (decision layer: judge signals, produce goals)
  → GoalEngine (goal economy: goals compete for execution resources)
  → EngineeringSwarm / MAX (execution layer)
  → SwarmOptimizer (records outcomes → self-improvement loop)
```

### Onion Layer Model
| Layer | Purpose | Key Files |
|-------|---------|-----------|
| Kernel | Infrastructure, stability | `SomaBootstrap.js`, `MessageBroker.cjs`, `ToolRegistry.js` |
| Perception | Awareness of environment | `daemons/`, `DaemonManager.js` |
| CNS | Signal routing + compression | `MessageBroker.cjs`, `SignalCompressor.js`, `SignalSchema.js` |
| Cognition | Reasoning, reflection, memory | `MnemonicArbiter`, `QuadBrain`, `ThoughtNetwork` |
| Agency | Intent, curiosity, goals | `SelfImprovementCoordinator`, `GoalPlannerArbiter`, `ASIKernel` |
| Applications | Execution systems | `EngineeringSwarmArbiter`, MAX swarm |

Agency execution ownership: `AutonomousHeartbeat` is the primary autonomous goal executor. It polls `GoalPlannerArbiter`, uses `SomaAgenticExecutor` when tool-backed work is needed, and broadcasts progress through WebSocket. `GoalExecutorDaemon` is only a supervised fallback for pending/proposed goals when the heartbeat is disabled or stopped; do not make both loops execute the same goal concurrently.

### Daemons (Perception Layer)
All daemons extend `BaseDaemon` and are managed by `DaemonManager` (with watchdog auto-restart):

| Daemon | Interval | Signal emitted |
|--------|----------|----------------|
| `RepoWatcherDaemon` | event-based | `repo.file.changed`, `repo.file.added` |
| `HealthDaemon` | 30s | `health.metrics`, `health.warning` |
| `OptimizationDaemon` | 1h | `swarm.optimization.needed` |
| `DiscoveryDaemon` | 24h | `swarm.discovery.ideas` |

DaemonManager watchdog: checks every 15s, circuit-breaks at 5 crashes (10 min backoff).

### Engineering Swarm Cycle
`EngineeringSwarmArbiter.modifyCode(filepath, request)` runs:
1. **Research** — read file, understand context
2. **Plan** — generate verification shell commands (validated by `CommandPolicyEngine`)
3. **Debate** — adversarial AURORA brain reasoning (schema-validated via `SchemaValidator`)
4. **Synthesis** — draft final patch (schema-validated `PatchSchema`)
5. **Transaction** — `SwarmPatchTransaction` applies multi-file changes atomically with rollback
6. **Verification** — execute plan commands, confirm change is live
7. **Optimization** — record outcome to `SwarmOptimizer` for self-improvement

### Signal Schema (CNS vocabulary)
Defined in `core/SignalSchema.js`. Key types:
- `repo.file.changed` — requires `path`, `filename`
- `health.metrics` — requires `cpuUsage`, `ramUsage`, `dbSizeGB`
- `health.warning` — requires `issue`, `details`
- `swarm.experience` — requires `sessionId`, `filepath`, `success`
- `swarm.optimization.needed` — requires `successRate`, `totalRuns`
- `swarm.discovery.ideas` — requires `ideas`

Unknown signal types warn but pass (forward-compatible).

### Attention Engine
`AttentionArbiter` is wired as `messageBroker.attentionEngine`. It gates every signal before delivery:
- Emergency/high priority → always pass
- Low priority + CPU > 80% + not in focus topic → suppressed
- `setFocus(topic, durationMs)` shifts system attention, broadcasts to CNS

This is what prevents **arbiter storms** as the arbiter count grows (currently 178).

---

## Known Gaps & Active Risks

### Critical
- **CJS/ESM fragmentation** — `BaseDaemon.js` is ESM but imports `MessageBroker.cjs`. `BaseArbiter.cjs` is CJS. Mixed module formats create subtle interop bugs. Long-term path: migrate all `.cjs` to ESM. Do NOT mix `require()` and `import` in the same file — Node.js will error. **Partial fix done:** `core/MessageBroker.js` ESM shim now exists — new ESM files can `import messageBroker from '../../core/MessageBroker.js'` instead of using `createRequire` boilerplate.
- **AttentionArbiter requires BaseArbiterV4** — `arbiters/BaseArbiter.js` exports V4. If that file moves or renames, AttentionArbiter silently gets `undefined` and the CNS gate disappears. The `messageBroker.attentionEngine` check is the safety net.
- **EngineeringSwarmArbiter needs quadBrain** — If QuadBrain isn't ready when perception phase boots, `quadBrain: null` is passed silently. The arbiter will fail on first `modifyCode()` call. Consider checking `this.system.quadBrain` before instantiation.

### Medium
- **Lobe routing partially migrated** — `subscribeByLobe()` is implemented; 8 arbiters migrated (GoalPlanner, DiagnosticCortex, CuriosityEngine, MnemonicArbiter + 4 others with lobe metadata). Remaining arbiters still use flat subscriptions. Continue migration to reduce fan-out.
- **SwarmOptimizer.improve() calls engineeringSwarm.modifyCode()** on the swarm's own code — this is recursive self-modification. It is intentional but dangerous. It is gated by `successRate < 0.8 && totalRuns > 5`, meaning it only fires when the swarm is already underperforming. Keep this gate.
- **DiscoveryDaemon prototypes ideas without human review** — `discoverySwarm.prototype()` calls `engineeringSwarm.modifyCode()` on `experiments/` dir. Sandbox to that directory only. `SwarmPatchTransaction` already enforces rootPath bounds.

### Low
- **DaemonManager watchdog is in-process** — if Node.js crashes entirely, the watchdog dies with it. For true resilience, daemons should be supervised by a process manager (PM2, systemd). The watchdog handles in-process crashes only.
- **SignalCompressor flushes on timeout only** — if a signal type gets one signal and then nothing for 1s, it flushes normally. If the system is idle for >1s between signals of the same type, compression doesn't happen. This is fine at current scale but worth knowing.
- **NEMESIS pattern index** — ~~FIXED: pre-computed bad-pattern index added to `NemesisArbiter.js`. Persists to `.soma/nemesis_patterns.json`, learns from caught revisions. Fast path is <1ms; brain-call eval only fires for novel patterns not in index.~~
- **Boot greeting is forced behavior** — ~~FIXED: Phase 3 forced boot greeting removed from `server/loaders/websocket.js`. Proactive speech now only via CuriosityEngine/GoalPlanner drives.~~

### Ethereal Memory Layer (implemented)
Third memory tier between warm (vector recall) and cold (SQLite) — now live.

**Ethereal tier** (`EtherealMemoryArbiter.js`) — memories that don't surface as explicit recall but influence reasoning tone and associative leaps. Dream pass runs after each chat response in `somaRoutes.js`, extracting 3-5 low-salience concepts. Stored in a 48h ring buffer (max 200 entries), persisted to `.soma/ethereal_buffer.json`. Biases ThoughtNetwork node weights without injecting explicit `[MEMORY]` blocks.

Key design held: decays fast (48h TTL), never quoted back explicitly, influences rather than asserts.

---

## Roadmap

### Done
- [x] `DaemonManager` with watchdog + circuit breaker
- [x] `_phase_perception()` in `SomaBootstrap` — wires all new components at boot
- [x] `AttentionArbiter` wired as CNS gate (`messageBroker.attentionEngine`)
- [x] `EngineeringSwarmArbiter` + `SwarmOptimizer` + `DiscoverySwarm` booted with `quadBrain`
- [x] All 4 daemons registered and started with supervision
- [x] Signal reactions: `swarm.optimization.needed` → improve, `swarm.discovery.ideas` → prototype, `health.warning` → anomaly detector
- [x] `subscribeByLobe()` implemented in `MessageBroker.cjs` (zero arbiters use it yet)
- [x] Forced boot greeting removed from `websocket.js`
- [x] Machine migration: cluster mode → standalone, SOMA_INDEX_PATH fixed, hardcoded paths cleared

### Production Hardening (in progress)
- [x] **Wire HybridSearch in `extended.js`** — added after BraveSearch, gated by `SOMA_HYBRID_SEARCH=true` + heap < 400MB check. Storage tab live.
- [x] **Lobe routing migration** — Complete. All arbiters with lobe metadata now use lobe-scoped or tiered subscriptions. Cross-lobe signals intentionally remain flat. `ProactiveCouncilArbiter` → `subscribeTiered('strategic', ...)`. `GoalPlannerArbiter` → `subscribeTiered('strategic', 'swarm.experience', ...)`.
- [x] **Perception dashboard tab** — `/api/perception/health` enhanced with daemon list, lobe bar, tier breakdown, heap gauge, signal counts. `PerceptionPanel.jsx` updated to display all new data.
- [x] **NEMESIS redesign** — `evaluateResponse()` added to `NemesisArbiter.js`, `system.nemesis` wired in `extended.js`. Pre-computed bad-pattern index (<1ms fast path), learns from caught revisions, persists to `.soma/nemesis_patterns.json`.
- [x] **Ethereal memory layer** — `EtherealMemoryArbiter.js` created. Dream pass wired in `somaRoutes.js` after each chat response. Biases ThoughtNetwork nodes, 48h ring buffer, persists to `.soma/ethereal_buffer.json`.
- [x] **EngineeringSwarm API route** — `POST /api/soma/engineering/modify` with SSE streaming already existed; terminal phase updated to `'complete'`.
- [x] **SignalSchema expansion** — `goal.created`, `insight.generated`, `diagnostic.anomaly`, `experiment.result` already present (was already done).
- [x] **Arbiter tier hierarchy** — `tierIndex` added to MessageBroker CNS; `tier` tracked in `registerArbiter()`/`unregisterArbiter()`; `getArbitersByTier()` + `getTierBreakdown()` added; tier shown in `getMetrics()`. Infrastructure complete.
- [x] **ESM shim for MessageBroker** — `core/MessageBroker.js` created. New ESM files can `import messageBroker from '../../core/MessageBroker.js'` or destructure `{ subscribe, publish, ... }`. Full CJS→ESM migration deferred (requires updating ~178 importers simultaneously — do in a dedicated session).
- [x] **Frontend rebuild** — run after any `.jsx` changes. Completed this session: SomaPlanViewer Execution Log panel now visible.
- [x] **Tier-ordered signal delivery** — `publish()` dispatches strategic→cognitive→operational. `ProactiveCouncilArbiter` and `GoalPlannerArbiter` now use `subscribeTiered()` to activate the system.

### Next Session
- [ ] **Full MessageBroker CJS→ESM migration** — rename `MessageBroker.cjs` → replace with proper ESM, update every `.cjs` importer. Do in one atomic commit. High risk — dedicate a full session. The `MessageBroker.js` shim already covers new ESM files.

### Lobe Specialist System (trained models → production)

**Phase 1 — Train all lobes** (THALAMUS done, 3 remaining)
- [ ] Train LOGOS on: GitHub Code, Stack Overflow, arXiv CS, LeetCode w/ explanations — target 10K+ examples
- [ ] Train AURORA on: creative writing corpora, emotional dialogue, poetry analysis, music theory
- [ ] Train PROMETHEUS on: business case studies, game theory, strategic planning, military strategy texts
- [ ] Scale THALAMUS dataset to 10K+ (currently 997) — more CVEs, medical anomaly, incident post-mortems
- Scripts: `node scripts/hunt-datasets.mjs --lobe {lobe}` → `build-lobe-datasets.mjs` → `finetune_gemma3.py` → `export_lobe_gguf.py`

**Phase 2 — DPO self-improvement loop**
- [ ] Wire NEMESIS revision pairs as DPO training data — every caught bad response + correction = a training pair
- [ ] Add DPO training mode to `finetune_gemma3.py` (replace `Trainer` with `DPOTrainer` from trl)
- [ ] Save NEMESIS pairs to `SOMA/training-data/dpo/lobe-{lobe}-dpo-{timestamp}.jsonl`
- [ ] SOMA improves from production mistakes automatically, no human labelers needed

**Phase 3 — Wire lobes into QuadBrain (the Sandwich Pattern)**
- [ ] The architecture: user query → local lobe gets domain question → specialist answer injected as context → DeepSeek synthesizes final response
- [ ] DeepSeek stays as primary reasoning/synthesis engine (good, cheap, keeps Barry happy)
- [ ] Lobes run locally via Ollama (private, specialist, free)
- [ ] Nothing private leaves the machine — only the synthesized non-sensitive context hits DeepSeek
- [ ] Implementation: add `_querySpecialistLobe(domain, prompt)` to `SOMArbiterV2_QuadBrain.js` — calls `ollama run soma-{lobe}`, injects response as `[SPECIALIST CONTEXT]` block before DeepSeek call
- [ ] Domain classifier maps query keywords → lobe (reuse keyword taxonomy from `build-lobe-datasets.mjs`)

**Phase 4 — Continual learning pipeline**
- [ ] Wire `CuriosityEngine` to trigger `hunt-datasets.mjs` when it finds a knowledge gap
- [ ] Scheduled retrain: new data → rebuild FINAL → retrain lobe → `ollama create soma-{lobe}` hot-swap
- [ ] SOMA decides what she needs to learn next without manual intervention

**Phase 5 — Upgrade base models as they drop**
- [ ] Pipeline is base-model agnostic — swap `--model` flag, retrain in ~30 min
- [ ] Watch for: Qwen3 small series, Phi-4-mini, Mistral small updates
- [ ] Quantize deployed GGUFs to Q4_K_M (~2.5GB vs 7.9GB) for faster Ollama inference

### Medium-term
- [ ] **Arbiter hierarchy tiers** — Strategic arbiters decide priorities, Cognitive arbiters analyze, Operational arbiters produce tasks. Prevents all arbiters firing simultaneously on the same signal. Implement as `tier: 'strategic' | 'cognitive' | 'operational'` metadata on `registerArbiter()` and route signals by tier order.
- [ ] **Reflex vs Deliberate split** — fast signals (test.failure → debug swarm) bypass the deliberate pipeline. Slow signals accumulate for periodic reflection. Wire `priority: 'emergency'` as the reflex gate (SignalCompressor already bypasses compression for these).
- [ ] **MAX ↔ SOMA swarm unification** — MAX's `SwarmCoordinator.js` is the simple version. Route MAX `/swarm` commands through to `EngineeringSwarmArbiter` for complex engineering tasks. MAX keeps simple swarm for quick parallel queries.
- [ ] **Hierarchical Swarm Subagents (Antigravity-inspired)** — Evolve SOMA's flat SwarmWorker system into specialized hierarchical subagents (e.g., Codebase Researcher, Database Debugger, Sandbox Validator) utilizing workspace branching/sharing (using `git worktree`-style directories to avoid concurrent file conflicts) and point-to-point mailbox queues rather than flat CNS broadcasts.
- [x] **Experience ledger** — `mnemonicArbiter` now passed to `EngineeringSwarmArbiter` at boot. `runResearch()` queries MnemonicArbiter for past swarm experiences with that file (2s timeout, non-fatal). Past experience injected into debate prompt as `[PAST EXPERIENCE WITH THIS FILE]` block.
- [ ] **CapabilityRegistry → dashboard** — show discovered + prototyped capabilities in a tab. Allow Barry to promote experiments to production with one click.

### Long-term (ASI evolution path)
- [ ] **Swarm Genome** — each SwarmWorker has a genome (weights on research depth, debate rounds, verification rigor). `SwarmOptimizer` evolves genomes based on outcome history. Better-performing workers reproduce; failing patterns fade.
- [ ] **Curiosity Reactor** — autonomous research engine that generates open questions from system signals, dispatches research swarms, and injects findings into the knowledge graph. Feeds `GoalPlannerArbiter` with discovered improvement opportunities.
- [ ] **Meta-Learning Layer** — SOMA tracks which of its own arbiters perform well on which task types. Routes future similar tasks to the historically best arbiter. Implements arbiter-level reinforcement learning.
- [x] **Attention Engine v2** — `AttentionArbiter.evaluateSignal()` returns `{ pass, score }`. `MessageBroker._deliverSignal()` tiers by score: ≥0.7 immediate, 0.3–0.69 normal, <0.3 deferred 200 ms batch (sorted by score). Zero arbiter changes needed — single choke point swap. `shouldNotice()` kept as compat wrapper.
- [ ] **SOMA as platform** — once the COS is stable, external systems (Dementia OS, finance agents, etc.) register as arbiters. They get perception, memory, and the full CNS for free. SOMA becomes the substrate.
