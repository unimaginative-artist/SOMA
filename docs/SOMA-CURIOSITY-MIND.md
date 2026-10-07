# SOMA's Curiosity Mind

Started 2026-09-14. Replaces the old one-minute curiosity loop.

## What was wrong before

- The old `CuriosityEngine` ran every minute but was never handed a brain (the loader passes it as
  `quadBrain`, the engine only looked for `brain`). 26,869 explorations, **0 completed**, nothing remembered.
- It re-explored the same unfixable items thousands of times: audio processing 7,300×, real-time video
  7,274×, physical body 7,266×, "improve medical from 0%" 1,097×.
- Stats were inflated ("114,000 knowledge gaps" = the same 31 recounted every 5 minutes).
- Her last proactive message to Owner was 2026-09-05.

## How it works now (`core/CuriosityMind.js`)

A light heartbeat every 2 minutes makes **no model calls**. It only lets SOMA notice how she feels.
She acts when a pressure crosses its threshold, and the strongest pressure wins:

| Drive | Builds when | What she does |
|---|---|---|
| **Curiosity** | a question stays open and pulls at her | picks the most intriguing question (or wonders up new ones from what Owner said, what she read, what she believes), searches through **Aperture**, her own window onto the web (her index + live DuckDuckGo + Gray Matter Network peers, honouring Aperture's network-access setting; DuckDuckGo directly only if Aperture is down; never Brave), reads the pages, forms a view, and the reading raises follow-up questions (up to 5 deep) |
| **Self-inquiry** ("what am I doing?") | something about her doesn't add up: new crashes in `logs/launcher_debug.log`, goals mostly failing, research finding nothing, RAM/disk pressure, DeepSeek down, a limitation she never understood, or a queued "why?" | asks why using measured evidence, her machine (CPU, RAM, GPU, loaded models, camera state) and **her own source code**; ends with a belief ("this is my constraint"), a next "why?" (up to 4 deep), or, for a confident bug, a *Diagnose why…* proposal into the existing self-repair pipeline (MAX still reviews changes) |
| **Missing Owner** | hours since he last talked to her (Command Bridge chat or Discord), faster when she found something he'd care about | shares the find with its source link, or after ~18h of silence asks what he's up to using real facts (last things he said, recent commits, Command Bridge activity) |

### Honesty and limits

- Messages go to Discord and the Command Bridge through `ProactivePresence.curiosityMessage` and the
  `OutboundAutonomyGate`: must carry evidence, may **not** claim she did/fixed/built anything.
- At most **3 messages/day**, none 11pm–8am, at least 3h apart.
- She learns from replies: an answer within 12h lowers her hesitation; no answer within 24h raises it.
- Daily budgets: 30 explorations, 10 self-inquiries, 2 repair proposals. Model calls run in the background
  lane and yield while Owner is chatting.

### Where what she learns goes

- Long-term memory (`curiosity_discovery`, `opinion`, `self_inquiry` entries) → surfaces in chat.
- Working memory → her "current state" in every chat (open wonders, recent discoveries).
- Work ledger (with source links) → evidence for the proactive loop.
- Aperture: pages she read are indexed (`source: soma:curiosity`) and her searches/visits appear in Portal
  history, so Owner can see where she went and search what she read.
- `SOMA/curiosity-journal.jsonl` → full diary of wonders, readings, self-inquiries, messages, replies.
- `SOMA/training-data/curiosity/curiosity-grounded.jsonl` → only examples backed by real sources; added to
  the existing training merge. Training stays benchmark-gated: a model is only trusted if it scores better
  than the base model (`data/lobe-trust.json`), because earlier self-training made the models worse.

## Checking on her

- `GET http://localhost:3001/api/curiosity/mind` — drives, what she's wondering, beliefs, pending whys,
  recent messages, stats, last 20 journal entries (`?journal=100` for more). Local machine only.
- `POST http://localhost:3001/api/curiosity/mind/tick` with `{"force":"explore"|"wonder"|"self_inquiry"|"reach_out"}`
  forces one action (budgets, quiet hours and caps still apply).
- Offline test (no network, no model spend): `node scripts/test-curiosity-mind.mjs`.

## Knobs

| Env var | Default |
|---|---|
| `SOMA_CURIOSITY_MIND=false` | turns the mind off and restores the old engine loop |
| `SOMA_CURIOSITY_MESSAGES=false` | she keeps exploring but never messages |
| `SOMA_CURIOSITY_MESSAGES_PER_DAY` | 3 |
| `SOMA_CURIOSITY_EXPLORATIONS_PER_DAY` | 30 |
| `SOMA_CURIOSITY_SELF_INQUIRIES_PER_DAY` | 10 |
| `SOMA_CURIOSITY_PROPOSALS_PER_DAY` | 2 |
| `SOMA_CURIOSITY_TICK_MS` | 120000 |
| `SOMA_CURIOSITY_WHY_SPACING_MS` | 1800000 (a follow-up "why?" waits 30 min) |

### Self-inquiry fixes (2026-09-14 afternoon)

The first live day showed two problems: a five-deep why-chain ran in ten minutes and used the whole day's
10 self-inquiries, and every link was "which line does this?" answered "I can't tell from what I have",
because she only saw the code tied to the original symptom.

- **She searches her own code (read-only).** Names in the question (`backticked`, snake_case, camelCase,
  file names) are looked up with `git grep` across core, arbiters, server, daemons, cognitive, marionette and
  the launcher; the matching code is shown to her and the journal records what she searched and found.
  Example: `execution_attempt_budget_exhausted`, which she couldn't locate, is in
  `server/services/AutonomousHeartbeat.cjs:1730`.
- **Follow-up whys wait 30 minutes**, so a chain of four takes about two hours instead of ten minutes.

## Verified results

### Offline — `node scripts/test-curiosity-mind.mjs` — 49/49

Drives, choosing the strongest pressure, wondering from what Owner said, reading with sources, why-chains,
beliefs, limitations becoming understood constraints, new crashes triggering "why?", repair proposals,
Portal-first search + Portal history/index, Aperture network permission, unrelated pages dropped, honest
misses not stored, quiet hours, message caps, first-person work claims blocked, replies/ignores changing her
hesitation, persistence across restarts. Existing gate/presence tests: 12/12.

### Live against running SOMA (2026-09-14, three restarts via Marionette, no rollback)

- **Self-inquiry (real brain + her own source):** asked why the old engine never completed an exploration,
  read `arbiters/CuriosityEngine.js`, filed a *Diagnose why…* proposal, formed the belief *"I was counting my
  intentions as if they were my achievements"*, and queued the right next why ("does any code path actually
  increment the completed counter?"). Her explanation itself was only partly right, which is why proposals
  go through diagnosis and MAX review rather than straight to a code change.
- **Unprompted self-inquiry on failing goals:** *"I do not fail seven ways; I run out of one shared allowance
  seven times, and I have never recorded what spends it."*
- **Wondering:** her own questions came from recent work (the Pulse LAN guard, validation pipeline).
- **Portal:** search returned live DuckDuckGo results; her search (`research`) and the pages she read
  (`reader`) appear in Portal history.
- **Bug found live and fixed:** Portal's loose local index returned old octopus pages for an Express question.
  She said the pages didn't answer it, but it was still stored. Now results are ranked by the question's words
  and a `relevant:false` reading stores nothing (the one bad training example was removed).
- **After the fix:** a sourced, relevant reading (deterministic scanners vs LLM reviewers) that she connected
  to her own `validation-results.json`, with three follow-up questions.
- Old engine: stuck audio/video/embodiment questions gone from its queue; its loop no longer runs.

### Not yet seen live

- A message to Owner. Her "missing Owner" pressure was still low (~0.15) at the time of writing; it builds over
  hours of silence or with a find worth sharing, and is capped at 3/day outside 11pm–8am.
- Sentence-boundary trimming of notes (committed after the last restart; active on the next one).
