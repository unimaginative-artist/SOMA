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
