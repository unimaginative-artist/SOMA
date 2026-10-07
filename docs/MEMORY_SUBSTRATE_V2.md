# SOMA Memory Substrate V2

Memory Substrate V2 is a governed, parallel replacement for the legacy token-hash JSON index. It does not delete or repurpose `soma-vectors.json`.

## Safety model

- SQLite source memories remain the durable source of truth.
- Admission decisions are append-only and include content hash, classifier version, actor, reason, and prior decision.
- A `gold_locked` decision remains effective even if a newer automated proposal disagrees.
- Gold records are accepted only after their source content matches fixed verification phrases; reruns cannot silently relock changed content.
- Missing, stale, or conflicting decisions fail closed and are not embedded.
- The semantic index remains in shadow mode until at least eight fixed retrieval cases pass, it beats the lexical baseline, at least 95% of effectively admitted source memories are indexed, and the gold ledger has zero conflicts.
- The old Mnemonic hot/warm/cold path remains available on every V2 failure.

## Retrieval

Admitted memories are sentence-aware chunks with parent memory IDs. Every vector records its encoder identity and dimensions. Recall fuses SQLite FTS5 and normalized dense similarity using reciprocal-rank fusion, with a small importance boost.

## Behavior handoff

`MemoryBehaviorGate` records the stages from capture through behavior change. It also exposes a deterministic constraint for the known observation-only-loop lesson: an unchanged attempt with no new evidence and no artifact-producing plan is rejected.

The executor must call this gate before the system can claim that remembered constraints govern autonomous actions. Retrieval and behavioral enforcement are intentionally tested separately.

## Build and evaluate

Run a bounded shadow build:

```powershell
node scripts/build-semantic-memory.mjs --limit=1000
```

Build the full admitted corpus:

```powershell
node scripts/build-semantic-memory.mjs --limit=all
```

Resume in bounded batches without rescanning already-complete records:

```powershell
node scripts/build-semantic-memory.mjs --limit=500 --pending-only
```

Promotion is deliberately explicit and will fail unless the candidate passes the fixed suite, beats the lexical baseline, covers at least 95% of admitted memories, and has no locked-admission conflicts:

```powershell
node scripts/build-semantic-memory.mjs --limit=all --promote
```

Runtime authority can be forced for controlled diagnostics with `SOMA_MEMORY_V2_AUTHORITY=true`, but normal deployment should use the recorded promotion gate.
