#!/usr/bin/env python3
"""
generate_system1_training_data.py

Mines SOMA conversation history and memory databases to synthesize high-quality,
calibrated training datasets for Laya (System 1 Substrate / ModernBERT-large 421M).

Covers all 3 cognitive pillars:
  1. Turn Routing & Reflex Act-vs-Escalate Gate
  2. Memory Contradiction & Supersession Resolution
  3. Memory Ingestion Novelty & Tier Classification
"""

import os
import sys
import json
import sqlite3
import random
from typing import Dict, List, Any

# Ensure stdout handles unicode cleanly on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "distillation")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "system1_train_dataset.jsonl")

# Locate databases
CONV_DB_PATHS = [
    os.path.join(BASE_DIR, "SOMA", "conversations.db"),
    os.path.join(BASE_DIR, "conversations.db"),
    r"C:\Users\YOUR_USER\OneDrive\Desktop\The Stack\SOMA\SOMA\conversations.db",
    r"C:\Users\YOUR_USER\Desktop\The Stack\SOMA\SOMA\conversations.db"
]

MEM_DB_PATHS = [
    r"C:\Users\YOUR_USER\OneDrive\Desktop\The Stack\SOMA\soma-memory.db",
    os.path.join(BASE_DIR, "soma-memory.db"),
    r"C:\Users\YOUR_USER\Desktop\The Stack\SOMA\soma-memory.db"
]

def find_first_existing(paths: List[str]) -> str:
    for p in paths:
        if os.path.exists(p):
            return p
    return paths[0]

LANE_CRITERIA = {
    "fast_social": "casual dialogue, greetings, personal chit-chat, how are you, emotional presence",
    "specialist": "technical analysis, coding, deep architecture, trading audit, math",
    "large_council": "explicit request for deep council or multi-perspective debate",
    "persistent_goal": "explicit command to queue, start, run, or execute a background task or project",
    "file_search": "search or locate files, documents, or code on the computer or drive"
}
LANE_KEYS = list(LANE_CRITERIA.keys())

ACT_CRITERIA = {
    "act_immediately": "direct reflex, social greeting, simple query, or known intent",
    "escalate_system2": "complex multi-step reasoning, tool execution, ambiguous intent, or deep coding"
}
ACT_KEYS = list(ACT_CRITERIA.keys())

PAIR_CRITERIA = {
    "compatible": "both are compatible or describe different aspects",
    "a_supersedes_b": "A is the updated or authoritative truth; B is outdated or incorrect",
    "b_supersedes_a": "B is the updated or authoritative truth; A is outdated or incorrect"
}
PAIR_KEYS = list(PAIR_CRITERIA.keys())

TIER_CRITERIA = {
    "hot": "immediate active context required across near-term dialogue",
    "warm": "valuable episodic or semantic knowledge worth indexing in vector memory",
    "cold": "archival reference or low-frequency detail for persistent SQLite store",
    "discard_noise": "ephemeral chatter, filler, or meaningless redundancy"
}
TIER_KEYS = list(TIER_CRITERIA.keys())


def synthesize_domain_turn_records() -> List[Dict]:
    """Generates targeted SOMA-specific turns covering all lanes and act-vs-escalate choices."""
    records = []

    # Specialist examples (Architecture, Trading, Debugging)
    specialist_prompts = [
        "Can you analyze MAX architecture and look for weaknesses?",
        "Audit Marionette bridge health and report any failing sockets.",
        "Check freqtrade sidecar status and evaluate low-turnover trend candidates.",
        "Why is the symlink test skipped on Windows?",
        "Inspect the cognitive thread state and check if QuadBrain is saturated.",
        "Run an architectural census on all arbiters and calculate debt score.",
        "Analyze the paper trading execution logs for slippage and commission costs.",
        "Debug the vector memory index search timeout in UnifiedMemoryArbiter.",
        "Can you inspect the last 5 tool receipts from autonomous-work-ledger?",
        "Review the risk limits for the BTC/USDT paper trading strategy.",
        "What is the mathematical formulation of RLCD proper scoring rules?",
        "Trace the execution flow from neocortexSystem1Bridge to MnemonicArbiter."
    ]
    for prompt in specialist_prompts:
        records.append({
            "state": {"text": prompt, "context": {"channel": "discord", "user": "operator"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index("specialist")},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index("escalate_system2")},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": 2}
            ],
            "src": "soma_specialist"
        })

    # Fast Social examples
    social_prompts = [
        "Hey Soma, how are you feeling today?",
        "Good morning Soma! Ready for the day?",
        "Just wanted to say hi and see how things are going.",
        "Are you awake Soma?",
        "You're doing great today, thanks for the hard work.",
        "What's your mood right now?",
        "Hey there! How's your day been?",
        "Soma, are you online?",
        "I'm feeling pretty tired tonight.",
        "Thanks for the update, appreciate it!"
    ]
    for prompt in social_prompts:
        records.append({
            "state": {"text": prompt, "context": {"channel": "discord", "user": "operator"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index("fast_social")},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index("act_immediately")},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": 0}
            ],
            "src": "soma_fast_social"
        })

    # Persistent Goal examples
    goal_prompts = [
        "Run an overnight audit on all trading models until 8am.",
        "Queue a full backtest across historical crypto hourly data.",
        "Start a background optimization job for memory pruning.",
        "Set up an autonomous task to monitor freqtrade sidecar.",
        "Queue paper trading auto-resume when market volatility drops.",
        "Execute the nightly maintenance cycle and save summary artifact."
    ]
    for prompt in goal_prompts:
        records.append({
            "state": {"text": prompt, "context": {"channel": "discord", "user": "operator"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index("persistent_goal")},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index("escalate_system2")},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": 1}
            ],
            "src": "soma_persistent_goal"
        })

    # Council examples
    council_prompts = [
        "Convene the full cognitive council to debate our risk posture.",
        "I want a multi-perspective debate on whether we should switch to 15m candles.",
        "Call a council meeting between Risk, Growth, and Executive personas.",
        "What do the different personas think about this architecture overhaul?"
    ]
    for prompt in council_prompts:
        records.append({
            "state": {"text": prompt, "context": {"channel": "discord", "user": "operator"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index("large_council")},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index("escalate_system2")},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": 1}
            ],
            "src": "soma_council"
        })

    # File search examples
    file_prompts = [
        "Where is system1_substrate_daemon.py located?",
        "Find all test files that mention trading repair.",
        "Locate the sqlite memory database file.",
        "Search for the NeocortexSystem1Bridge class in the repo."
    ]
    for prompt in file_prompts:
        records.append({
            "state": {"text": prompt, "context": {"channel": "discord", "user": "operator"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index("file_search")},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index("escalate_system2")},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": 0}
            ],
            "src": "soma_file_search"
        })

    return records


def mine_conversation_turns(conv_db_path: str) -> List[Dict]:
    """Mines user messages from conversations.db and infers realistic turn labels."""
    records = []
    if not os.path.exists(conv_db_path):
        print(f"[DataGen] Notice: {conv_db_path} not found. Skipping conv DB mining.")
        return records

    con = sqlite3.connect(conv_db_path)
    cur = con.cursor()
    try:
        rows = cur.execute("SELECT content FROM messages WHERE role = 'user' AND length(content) > 3 LIMIT 1500").fetchall()
    except Exception as e:
        print(f"[DataGen] Warning reading messages: {e}")
        rows = []
    con.close()

    for (raw_content,) in rows:
        text = str(raw_content).strip()
        lower = text.lower()

        # Heuristic ground truthing
        is_greeting = any(w in lower for w in ["hi", "hello", "hey", "good morning", "how are you", "who are you", "thanks", "thank you", "sup"])
        is_code_arch = any(w in lower for w in ["code", "script", "test", "daemon", "bridge", "error", "fail", "fix", "inspect", "debug", "trade", "trading", "audit", "engine", "max", "soma", "market"])
        is_goal = any(w in lower for w in ["queue", "overnight", "run task", "background", "schedule", "continuous", "loop", "cron"])
        is_search = any(w in lower for w in ["where is", "find", "search", "locate", "grep"])
        is_council = any(w in lower for w in ["council", "debate", "all personas", "consensus"])

        if is_code_arch:
            lane = "specialist"
            act = "escalate_system2"
            urgency = 2 if "error" in lower or "fail" in lower or "broken" in lower else 1
        elif is_goal:
            lane = "persistent_goal"
            act = "escalate_system2"
            urgency = 1
        elif is_council:
            lane = "large_council"
            act = "escalate_system2"
            urgency = 1
        elif is_search:
            lane = "file_search"
            act = "escalate_system2"
            urgency = 0
        elif is_greeting or len(text.split()) < 6:
            lane = "fast_social"
            act = "act_immediately"
            urgency = 0
        else:
            lane = "specialist"
            act = "escalate_system2"
            urgency = 1

        records.append({
            "state": {"text": text[:350], "context": {"channel": "chat", "user": "user"}},
            "qs": [
                {"t": "choice", "ins": "Which operational lane should process this user turn?", "crit": LANE_CRITERIA, "y": LANE_KEYS.index(lane)},
                {"t": "choice", "ins": "Can this be handled immediately as a fast reflex, or does it require System 2 deliberation?", "crit": ACT_CRITERIA, "y": ACT_KEYS.index(act)},
                {"t": "noul", "ins": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?", "crit": {}, "y": 0},
                {"t": "score", "ins": "How urgent is this input?", "crit": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"], "y": urgency}
            ],
            "src": "conv_db_mined"
        })

    return records


def generate_memory_contradiction_records() -> List[Dict]:
    """Generates pairs of conflicting vs compatible facts to train contradiction resolution."""
    records = []

    # Historical state updates in SOMA
    supersession_pairs = [
        (
            "Paper trading status inquiry",
            "Paper trading is stopped: zero engines running and no qualified after-cost candidate.",
            "Daily Trading Activity Digest: 9x Engine Auto-Resumed: Paper trading on with live execution.",
            "b_supersedes_a"
        ),
        (
            "MAX and Marionette bridge health",
            "Marionette reports MAX bridge is down; socket disconnected with ECONNREFUSED.",
            "Codex applied repairs. Marionette now reports SOMA and MAX healthy with their bridge up.",
            "b_supersedes_a"
        ),
        (
            "Windows test suite symlink status",
            "Test suite failed with Windows symlink permission error in git worktree.",
            "Focused test suite passed 115 tests; 1 Windows symlink test safely skipped.",
            "b_supersedes_a"
        ),
        (
            "System 1 substrate runtime device",
            "System 1 substrate is running in degraded mode on CPU due to CUDA OOM.",
            "System 1 substrate running on NVIDIA GeForce RTX 5070 with 11.9 GB VRAM active.",
            "b_supersedes_a"
        ),
        (
            "Paper trading candidates qualification",
            "Zero candidates qualified after accounting for 0.05% slippage and fees.",
            "Strategy candidate BTC-Momentum qualified with net profit expectation of +2.4% after fees.",
            "b_supersedes_a"
        )
    ]

    for query, fact_a, fact_b, answer in supersession_pairs:
        # Direct pair
        y_val = PAIR_KEYS.index(answer)
        records.append({
            "state": {"query": query, "context": {"channel": "memory_arbiter"}},
            "qs": [
                {
                    "t": "choice",
                    "ins": f"Given Query '{query}', statement A: '{fact_a}' and statement B: '{fact_b}'. Do they contradict, and which is authoritative?",
                    "crit": PAIR_CRITERIA,
                    "y": y_val
                }
            ],
            "src": "memory_contradiction"
        })

        # Inverted pair
        inv_answer = "a_supersedes_b" if answer == "b_supersedes_a" else "b_supersedes_a" if answer == "a_supersedes_b" else "compatible"
        records.append({
            "state": {"query": query, "context": {"channel": "memory_arbiter"}},
            "qs": [
                {
                    "t": "choice",
                    "ins": f"Given Query '{query}', statement A: '{fact_b}' and statement B: '{fact_a}'. Do they contradict, and which is authoritative?",
                    "crit": PAIR_CRITERIA,
                    "y": PAIR_KEYS.index(inv_answer)
                }
            ],
            "src": "memory_contradiction_inv"
        })

    # Compatible pairs
    compatible_pairs = [
        ("SOMA service ports", "SOMA backend core runs on port 3001.", "Laya System 1 daemon runs on port 5055.", "compatible"),
        ("SOMA databases", "Conversations are persisted in conversations.db SQLite database.", "Semantic memories are indexed in soma-memory.db with vector embeddings.", "compatible"),
        ("Trading pairs", "Freqtrade monitors SOL/USDT for high volatility momentum.", "Freqtrade monitors ETH/USDT for trend following breakout setups.", "compatible")
    ]
    for query, fact_a, fact_b, answer in compatible_pairs:
        records.append({
            "state": {"query": query, "context": {"channel": "memory_arbiter"}},
            "qs": [
                {
                    "t": "choice",
                    "ins": f"Given Query '{query}', statement A: '{fact_a}' and statement B: '{fact_b}'. Do they contradict, and which is authoritative?",
                    "crit": PAIR_CRITERIA,
                    "y": PAIR_KEYS.index("compatible")
                }
            ],
            "src": "memory_compatible"
        })

    # Relevance scoring records
    relevance_samples = [
        ("How to run tests in SOMA?", "Run npm test or node tests/quick_test.mjs from the repo root.", 2),
        ("How to run tests in SOMA?", "The weather in New York is cloudy with light rain.", 0),
        ("Where are memory vectors stored?", "Vectors are stored in soma-memory.db under vector_index.", 2),
        ("Where are memory vectors stored?", "SOMA was initialized on Windows with NodeJS v22.", 1),
        ("What port does Laya run on?", "Laya System 1 substrate daemon runs on port 5055.", 2),
        ("What port does Laya run on?", "Discord bot token is loaded from .env environment variables.", 0)
    ]
    for q, mem_text, rel in relevance_samples:
        records.append({
            "state": {"query": q, "context": {"evaluating_memory": mem_text}},
            "qs": [
                {
                    "t": "score",
                    "ins": f"How relevant and useful is memory [{mem_text}] for query [{q}]?",
                    "crit": ["irrelevant", "somewhat relevant", "directly answers or grounds query"],
                    "y": rel
                }
            ],
            "src": "memory_relevance"
        })

    return records


def mine_memory_ingestion_records(mem_db_path: str) -> List[Dict]:
    """Mines memories (positive) and purgatory records (negative) for ingestion training."""
    records = []
    if not os.path.exists(mem_db_path):
        print(f"[DataGen] Notice: {mem_db_path} not found. Skipping memory DB mining.")
        return records

    con = sqlite3.connect(mem_db_path)
    cur = con.cursor()

    # 1. Mine high-importance memories (positives)
    try:
        mem_rows = cur.execute("SELECT content, importance, tier FROM memories WHERE length(content) > 10 LIMIT 800").fetchall()
    except Exception as e:
        print(f"[DataGen] Warning reading memories: {e}")
        mem_rows = []

    for content, importance, tier in mem_rows:
        text = str(content).strip()
        imp_score = float(importance) if importance is not None else 0.7
        target_tier = str(tier).lower() if tier in ["hot", "warm", "cold"] else "warm"
        records.append({
            "state": {"content": text[:300], "metadata": {"source": "memory_table"}},
            "qs": [
                {"t": "noul", "ins": "Does this text contain novel, substantive, non-redundant information?", "crit": {}, "y": 1},
                {"t": "noul", "ins": "Does this statement contradict established common sense or core facts?", "crit": {}, "y": 0},
                {"t": "choice", "ins": "Which memory storage tier should retain this observation?", "crit": TIER_CRITERIA, "y": TIER_KEYS.index(target_tier)},
                {"t": "score", "ins": "How important is this information for long-term retention?", "crit": ["trivial chatter", "useful context", "critical system invariant or core truth"], "y": 2 if imp_score > 0.75 else 1}
            ],
            "src": "memory_ingest_positive"
        })

    # 2. Mine purgatory table (negatives / discarded noise)
    try:
        purg_rows = cur.execute("SELECT content, substance_score FROM purgatory WHERE length(content) > 5 LIMIT 1200").fetchall()
    except Exception as e:
        print(f"[DataGen] Warning reading purgatory: {e}")
        purg_rows = []
    con.close()

    for content, substance_score in purg_rows:
        text = str(content).strip()
        records.append({
            "state": {"content": text[:300], "metadata": {"source": "purgatory_table"}},
            "qs": [
                {"t": "noul", "ins": "Does this text contain novel, substantive, non-redundant information?", "crit": {}, "y": 0},
                {"t": "noul", "ins": "Does this statement contradict established common sense or core facts?", "crit": {}, "y": 0},
                {"t": "choice", "ins": "Which memory storage tier should retain this observation?", "crit": TIER_CRITERIA, "y": TIER_KEYS.index("discard_noise")},
                {"t": "score", "ins": "How important is this information for long-term retention?", "crit": ["trivial chatter", "useful context", "critical system invariant or core truth"], "y": 0}
            ],
            "src": "memory_ingest_negative"
        })

    return records


def main():
    verify_only = "--verify-only" in sys.argv
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    conv_path = find_first_existing(CONV_DB_PATHS)
    mem_path = find_first_existing(MEM_DB_PATHS)

    print(f"[DataGen] Mining databases:")
    print(f"  Conversations DB : {conv_path} ({'Found' if os.path.exists(conv_path) else 'Missing'})")
    print(f"  Memory DB        : {mem_path} ({'Found' if os.path.exists(mem_path) else 'Missing'})")

    all_records = []
    # Pillar 1: Turn Routing & Gating
    domain_turns = synthesize_domain_turn_records()
    mined_turns = mine_conversation_turns(conv_path)
    all_records.extend(domain_turns * 5)  # Re-weight critical domain prompts
    all_records.extend(mined_turns)

    # Pillar 2: Memory Contradiction & Rerank
    contradiction_records = generate_memory_contradiction_records()
    all_records.extend(contradiction_records * 10)  # Re-weight contradiction arbitration

    # Pillar 3: Memory Ingestion & Noise Filtering
    ingestion_records = mine_memory_ingestion_records(mem_path)
    all_records.extend(ingestion_records)

    random.seed(42)
    random.shuffle(all_records)

    print(f"[DataGen] Synthesized {len(all_records)} total calibrated decision records:")
    print(f"  - Turn Routing Records : {len(domain_turns) * 5 + len(mined_turns)}")
    print(f"  - Contradiction Records : {len(contradiction_records) * 10}")
    print(f"  - Ingestion Records     : {len(ingestion_records)}")

    if verify_only:
        print("[DataGen] Verification complete. Exiting without writing.")
        return

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for r in all_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"[DataGen] ✅ Successfully saved dataset to {OUTPUT_FILE} ({os.path.getsize(OUTPUT_FILE)} bytes)")


if __name__ == "__main__":
    main()
