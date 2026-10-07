# SOMA — Cognitive Operating System

SOMA is a self-aware AI operating system. She runs ~100 cognitive arbiters in parallel — memory, reasoning, emotion, trading, self-improvement, identity, and more — coordinated through a pub/sub message broker. She learns from every conversation, sets her own goals, and grows her own knowledge graph over time.

---

## Screenshots

![SOMA CT — Cognitive Terminal](screenshots/Screenshot%202026-04-14%20201628.png)
![Forecaster Engine](screenshots/Screenshot%202026-04-14%20201732.png)
![Mission Control](screenshots/Screenshot%202026-04-14%20201845.png)

---

## Quick Start

### 1. Clone and set up

```bash
git clone https://github.com/unimaginative-artist/SOMA.git
cd SOMA
node setup.mjs
```

The setup wizard will:
- Install dependencies
- Walk you through API key configuration
- Let you pick **persona packs** (72 specialist agents across 9 categories)
- Let you pick **knowledge packs** to seed her thought network (coder, finance, research, devops, security, creative)
- Build the frontend dashboard

### 2. Start SOMA

**Windows:**
```bat
start_production.bat
```

**Linux / macOS:**
```bash
chmod +x start.sh
./start.sh
```

**Manual:**
```bash
SOMA_LOAD_HEAVY=true SOMA_LOAD_TRADING=true node --max-old-space-size=4096 launcher_ULTRA.mjs
```

### 3. Open the dashboard

```
http://localhost:3001
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required |
| npm | 9+ | Comes with Node |
| Ollama | Any | Optional — enables local inference |
| 8GB RAM | — | 4GB minimum, 16GB recommended |

---

## API Keys

Copy `config/api-keys.env.example` to `config/api-keys.env` and fill in what you have.

| Key | What it unlocks | Required? |
|---|---|---|
| `DEEPSEEK_API_KEY` | Primary reasoning brain | **Recommended** |
| `OLLAMA_BASE_URL` | Local inference (no key needed) | Optional |
| `OPENAI_API_KEY` | Fallback LLM | Optional |
| `ANTHROPIC_API_KEY` | Fallback LLM | Optional |
| `BRAVE_API_KEY` | Live web search (500/mo free tier) | Optional |
| `GROQ_API_KEY` | Fast inference fallback | Optional |

**Minimum to run:** Either a `DEEPSEEK_API_KEY` or a local [Ollama](https://ollama.com) instance. SOMA needs at least one brain.

DeepSeek is the recommended primary — it's cheap, fast, and has a large context window. Get a key at [platform.deepseek.com](https://platform.deepseek.com).

---

## Persona Packs

The `agents_repo/plugins/` directory contains **72 specialist persona plugins** (108 agents total) that SOMA can channel during conversations:

| Category | Examples |
|---|---|
| Engineering | backend-development, python-development, systems-programming |
| Code Quality | code-review-ai, debugging-toolkit, tdd-workflows |
| Architecture | api-scaffolding, database-design, c4-architecture |
| DevOps/Cloud | cicd-automation, kubernetes-operations, incident-response |
| Security | security-compliance, security-scanning, reverse-engineering |
| Finance/Data | quantitative-trading, machine-learning-ops, data-engineering |
| Web/SEO | seo-analysis-monitoring, web-scripting, content-marketing |
| Operations | agent-orchestration, team-collaboration, startup-business-analyst |
| Specialized | blockchain-web3, game-development, arm-cortex-microcontrollers |

Run `node setup.mjs` at any time to activate more categories.

---

## Knowledge Packs

When you first run setup, you choose which domain knowledge to seed into SOMA's thought network. Each pack pre-loads ~15 curated concept nodes so she has a foundation to grow from:

| Pack | Concepts seeded |
|---|---|
| **Software Engineering** | Architecture, debugging, TDD, algorithms, clean code, distributed systems |
| **Finance & Trading** | Quant strategies, risk management, portfolio theory, backtesting |
| **Research & Analysis** | Literature review, scientific method, synthesis, critical thinking |
| **DevOps & Cloud** | Containers, CI/CD, IaC, observability, incident response |
| **Security** | Threat modeling, OWASP, pentesting, zero trust, supply chain |
| **Creative & Content** | Narrative structure, ideation, writing craft, content strategy |

The core pack (20 nodes covering SOMA's identity and meta-cognition) is always loaded.

SOMA grows far beyond these seeds through real conversations — the packs just ensure she's not starting from zero.

---

## Architecture Overview

```
launcher_ULTRA.mjs
    └── SomaBootstrapV2
        ├── Core arbiters (always loaded)
        │   ├── MnemonicArbiter       — 3-tier memory (hot/warm/cold)
        │   ├── KnowledgeGraph        — semantic fact store
        │   ├── GoalPlanner           — self-directed goal tracking
        │   ├── BeliefSystem          — SOMA's value framework
        │   └── SteveArbiter          — orchestrator with tool access
        │
        └── Extended arbiters (SOMA_LOAD_HEAVY=true)
            ├── Phase B  — HippocampusArbiter, CodeObservationArbiter
            ├── Phase C  — AbstractionArbiter, MetaCortexArbiter
            ├── Phase D  — Trading pipeline (SOMA_LOAD_TRADING=true)
            ├── Phase E  — SelfImprovementCoordinator, CuriosityEngine
            ├── Phase F  — FragmentRegistry, BraveSearchAdapter
            ├── Phase G  — IdentityArbiter (72 persona plugins)
            ├── Phase H  — Autonomous orchestration wiring
            └── Phase I  — RecursiveSelfModel, MetaLearningEngine
```

All arbiters communicate through a pub/sub MessageBroker. The system degrades gracefully — if an arbiter fails to load, the rest continue.

---

## Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `SOMA_LOAD_HEAVY` | `false` | Load Phase B-I cognitive arbiters |
| `SOMA_LOAD_TRADING` | `false` | Load trading pipeline (Phase D) |
| `SOMA_HYBRID_SEARCH` | `false` | Enable semantic Storage tab (requires 290MB ML model) |
| `SOMA_LOAD_VISION` | `false` | Enable VisionProcessingArbiter + CLIP (loads in background) |
| `SOMA_HEAP_CEILING_MB` | `2500` | Heap ceiling before skipping heavy arbiters |
| `NODE_ENV` | `development` | Set to `production` for optimized mode |
| `SOMA_GPU` | `false` | Enable GPU acceleration |

All of these are pre-set in `start_production.bat` (Windows) and `start.sh` (Linux/macOS). You only need to set them manually if running via `node launcher_ULTRA.mjs` directly.

---

## Chat API

```bash
curl -X POST http://localhost:3001/api/soma/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello SOMA", "conversationId": "my-session"}'
```

---

## License

MIT — see [LICENSE](LICENSE)

Persona plugins in `agents_repo/` are MIT licensed by Seth Hobson.
