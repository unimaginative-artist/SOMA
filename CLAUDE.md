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
- **CJS/ESM fragmentation** — `BaseDaemon.js` is ESM but imports `MessageBroker.cjs`. `BaseArbiter.cjs` is CJS. Mixed module formats create subtle interop bugs. Long-term path: migrate all `.cjs` to ESM. Do NOT mix `require()` and `import` in the same file — Node.js will error.
- **AttentionArbiter requires BaseArbiterV4** — `arbiters/BaseArbiter.js` exports V4. If that file moves or renames, AttentionArbiter silently gets `undefined` and the CNS gate disappears. The `messageBroker.attentionEngine` check is the safety net.
- **EngineeringSwarmArbiter needs quadBrain** — If QuadBrain isn't ready when perception phase boots, `quadBrain: null` is passed silently. The arbiter will fail on first `modifyCode()` call. Consider checking `this.system.quadBrain` before instantiation.

### Medium
- **178 arbiters with no lobe-level routing** — MessageBroker routes signals to all subscribers of a topic. As signal volume grows, consider adding lobe-scoped subscription so only relevant-lobe arbiters receive signals.
- **SwarmOptimizer.improve() calls engineeringSwarm.modifyCode()** on the swarm's own code — this is recursive self-modification. It is intentional but dangerous. It is gated by `successRate < 0.8 && totalRuns > 5`, meaning it only fires when the swarm is already underperforming. Keep this gate.
- **DiscoveryDaemon prototypes ideas without human review** — `discoverySwarm.prototype()` calls `engineeringSwarm.modifyCode()` on `experiments/` dir. Sandbox to that directory only. `SwarmPatchTransaction` already enforces rootPath bounds.

### Low
- **DaemonManager watchdog is in-process** — if Node.js crashes entirely, the watchdog dies with it. For true resilience, daemons should be supervised by a process manager (PM2, systemd). The watchdog handles in-process crashes only.
- **SignalCompressor flushes on timeout only** — if a signal type gets one signal and then nothing for 1s, it flushes normally. If the system is idle for >1s between signals of the same type, compression doesn't happen. This is fine at current scale but worth knowing.

---

## Roadmap

### Done (this session)
- [x] `DaemonManager` with watchdog + circuit breaker
- [x] `_phase_perception()` in `SomaBootstrap` — wires all new components at boot
- [x] `AttentionArbiter` wired as CNS gate (`messageBroker.attentionEngine`)
- [x] `EngineeringSwarmArbiter` + `SwarmOptimizer` + `DiscoverySwarm` booted with `quadBrain`
- [x] All 4 daemons registered and started with supervision
- [x] Signal reactions: `swarm.optimization.needed` → improve, `swarm.discovery.ideas` → prototype, `health.warning` → anomaly detector

### Short-term (next sessions)
- [ ] **Migrate `MessageBroker.cjs` → `MessageBroker.js`** (ESM) and update all importers. Biggest CJS/ESM risk reduction.
- [ ] **Lobe-scoped signal routing** — add `subscribeByLobe(lobe, topic, handler)` to MessageBroker so only arbiters in the right lobe receive irrelevant signals.
- [ ] **Perception dashboard tab** — show daemon health (active/crashed/restart count), recent signals, attention focus, swarm queue depth in the dashboard. Expose `/api/perception/health` route.
- [ ] **EngineeringSwarm API route** — `POST /api/soma/engineering/modify` takes `{ filepath, request }`, runs the full swarm cycle, streams progress via SSE. Used by MAX when it dispatches complex engineering tasks.
- [ ] **SignalSchema expansion** — add `goal.created`, `insight.generated`, `diagnostic.anomaly`, `experiment.result` signal types. Wire `GoalPlannerArbiter` to emit `goal.created` when it generates goals from signals.

### Medium-term
- [ ] **Arbiter hierarchy tiers** — Strategic arbiters decide priorities, Cognitive arbiters analyze, Operational arbiters produce tasks. Prevents all arbiters firing simultaneously on the same signal. Implement as `tier: 'strategic' | 'cognitive' | 'operational'` metadata on `registerArbiter()` and route signals by tier order.
- [ ] **Reflex vs Deliberate split** — fast signals (test.failure → debug swarm) bypass the deliberate pipeline. Slow signals accumulate for periodic reflection. Wire `priority: 'emergency'` as the reflex gate (SignalCompressor already bypasses compression for these).
- [ ] **MAX ↔ SOMA swarm unification** — MAX's `SwarmCoordinator.js` is the simple version. Route MAX `/swarm` commands through to `EngineeringSwarmArbiter` for complex engineering tasks. MAX keeps simple swarm for quick parallel queries.
- [ ] **Experience ledger** — `EngineeringSwarmArbiter` already calls `_logToExperienceLedger()`. Feed this into `MnemonicArbiter` so SOMA remembers which approaches worked for which file types / request patterns.
- [ ] **CapabilityRegistry → dashboard** — show discovered + prototyped capabilities in a tab. Allow Barry to promote experiments to production with one click.

### Long-term (ASI evolution path)
- [ ] **Swarm Genome** — each SwarmWorker has a genome (weights on research depth, debate rounds, verification rigor). `SwarmOptimizer` evolves genomes based on outcome history. Better-performing workers reproduce; failing patterns fade.
- [ ] **Curiosity Reactor** — autonomous research engine that generates open questions from system signals, dispatches research swarms, and injects findings into the knowledge graph. Feeds `GoalPlannerArbiter` with discovered improvement opportunities.
- [ ] **Meta-Learning Layer** — SOMA tracks which of its own arbiters perform well on which task types. Routes future similar tasks to the historically best arbiter. Implements arbiter-level reinforcement learning.
- [ ] **Attention Engine v2** — currently binary (pass/suppress). Evolve to soft attention: signals get a relevance score, higher-score signals get more arbiter bandwidth. Implement as a priority queue in MessageBroker with configurable attention weights.
- [ ] **SOMA as platform** — once the COS is stable, external systems (Dementia OS, finance agents, etc.) register as arbiters. They get perception, memory, and the full CNS for free. SOMA becomes the substrate.
