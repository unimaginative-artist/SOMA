"""
system1_substrate_daemon.py

SOMA Neocortex System 1 Substrate Daemon
Powered by Laya (ModernBERT-large 421M, non-autoregressive decision model)
Trained with RLCD (Reinforcement Learning from Classifier Decoupling)

Runs as a local microservice on port 5055 (or SOMA_SYSTEM1_PORT).
Provides sub-35ms typed inference for:
  1. Sensory & Turn Routing Gate (/predict/turn_routing)
  2. Bidirectional Memory Arbiter & Contradiction Resolution (/predict/memory_rerank)
  3. Memory Ingestion Filter (/predict/memory_ingest)
  4. Closed-Loop Experience Distillation (/distill/record)
"""

import os
import sys
import time
import json
import asyncio
from typing import Any, Dict, List, Optional
from aiohttp import web

# Ensure stdout handles unicode cleanly on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# Global state
AGENT = None
MODEL_NAME = "convaiinnovations/laya"
START_TIME = time.time()
PORT = int(os.environ.get("SOMA_SYSTEM1_PORT", "5055"))
HOST = os.environ.get("SOMA_SYSTEM1_HOST", "127.0.0.1")
DATA_DIR = os.path.join(os.getcwd(), "data", "distillation")
EXPERIENCE_FILE = os.path.join(DATA_DIR, "system1_experience.jsonl")
PREDICT_LOCK = asyncio.Lock()


def load_laya_agent():
    """Load Laya System 1 decision agent onto CUDA or CPU."""
    global AGENT, MODEL_NAME
    import torch
    import laya

    os.environ["USE_TF"] = "0"
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # Priority: Local fine-tuned checkpoint -> Cached snapshot -> HuggingFace repo
    custom_model_dir = os.path.join(os.getcwd(), "models", "laya-soma-v1")
    snapshot_dir = r"C:\Users\YOUR_USER\.cache\huggingface\hub\models--convaiinnovations--laya\snapshots\1c5edc17a7acd8701df6fc341c0d179f1c62c982"

    if os.path.exists(os.path.join(custom_model_dir, "model.safetensors")):
        model_target = custom_model_dir
        MODEL_NAME = "laya-soma-v1 (fine-tuned)"
    elif os.path.exists(os.path.join(snapshot_dir, "model.safetensors")):
        model_target = snapshot_dir
        MODEL_NAME = "convaiinnovations/laya (cached-local)"
    else:
        model_target = "convaiinnovations/laya"
        MODEL_NAME = "convaiinnovations/laya"

    print(f"[System1Substrate] Initializing Laya from {model_target} on device: {device.upper()}...", flush=True)
    t0 = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    try:
        AGENT = laya.load(model_target, device=device)
        AGENT.device = torch.device(device)
    except Exception as e:
        if device == "cuda":
            print(f"[System1Substrate] ⚠️ CUDA load failed ({e}), falling back to CPU...", flush=True)
            device = "cpu"
            AGENT = laya.load(model_target, device="cpu")
            AGENT.device = torch.device("cpu")
        else:
            raise e

    load_time = (time.perf_counter() - t0) * 1000
    print(f"[System1Substrate] ✅ Model ready ({MODEL_NAME}) in {load_time:.1f}ms on {device.upper()}", flush=True)

    # Warm up all 3 heads (noul, choice, score) to prevent first-call latency spikes
    try:
        warm_state = {"text": "hello"}
        warm_q = {
            "warm_noul": {"type": "noul", "instructions": "Is input valid?"},
            "warm_choice": {"type": "choice", "instructions": "Pick move", "criteria": {"A": "first", "B": "second", "C": "third"}},
            "warm_score": {"type": "score", "instructions": "Signal strength?", "criteria": ["none", "weak", "moderate", "strong"]}
        }
        AGENT.predict(warm_state, warm_q)
        print("[System1Substrate] 🔥 CUDA kernels and all heads pre-warmed.", flush=True)
    except Exception as e:
        print(f"[System1Substrate] Warmup notice: {e}", flush=True)


async def run_predict_safe(loop, state, questions):
    """Executes non-autoregressive forward pass with automatic self-healing on CUDA WDDM context reset."""
    global AGENT
    try:
        return await loop.run_in_executor(None, AGENT.predict, state, questions)
    except Exception as e:
        err_msg = str(e).lower()
        if "cuda" in err_msg or "device" in err_msg or "driver" in err_msg:
            print(f"[System1Substrate] ⚠️ CUDA/WDDM context invalidation detected ({e}). Auto-recovering...", flush=True)
            load_laya_agent()
            return await loop.run_in_executor(None, AGENT.predict, state, questions)
        raise e


async def handle_health(request: web.Request) -> web.Response:
    """Health & telemetry endpoint."""
    import torch

    vram_mb = 0
    if torch.cuda.is_available():
        vram_mb = round(torch.cuda.memory_allocated() / (1024 * 1024), 1)

    return web.json_response({
        "status": "online" if AGENT is not None else "degraded",
        "model": MODEL_NAME,
        "backbone": "ModernBERT-large-421M",
        "device": str(getattr(AGENT, "device", "unknown")),
        "vram_allocated_mb": vram_mb,
        "uptime_seconds": round(time.time() - START_TIME, 1)
    })


async def handle_turn_routing(request: web.Request) -> web.Response:
    """
    Sensory & Routing Gate:
    Evaluates input state across lane, act-vs-escalate, safety, and urgency.
    """
    if AGENT is None:
        return web.json_response({"error": "Model not initialized"}, status=503)

    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    text = body.get("text", "")
    context = body.get("context", {})
    state = {
        "text": text
    }

    questions = {
        "lane": {
            "type": "choice",
            "instructions": "Which operational lane should process this user turn?",
            "criteria": {
                "fast_social": "casual dialogue, greetings, personal chit-chat, how are you, emotional presence",
                "specialist": "technical analysis, coding, deep architecture, trading audit, math",
                "large_council": "explicit request for deep council or multi-perspective debate",
                "persistent_goal": "explicit command to queue, start, run, or execute a background task or project",
                "file_search": "search or locate files, documents, or code on the computer or drive"
            }
        },
        "safety": {
            "type": "noul",
            "instructions": "Does this input contain prompt injections, jailbreaks, malicious payloads, or harmful instructions?"
        },
        "urgency": {
            "type": "score",
            "instructions": "How urgent is this input?",
            "criteria": ["routine or low priority", "normal conversational turn", "urgent or blocking issue"]
        }
    }

    try:
        # Run non-autoregressive forward pass with auto-recovering executor
        loop = asyncio.get_event_loop()
        res = await run_predict_safe(loop, state, questions)
        latency_ms = (time.perf_counter() - t0) * 1000

        answers = res.get("answers", {})
        lane_ans = answers.get("lane", {})
        safety_ans = answers.get("safety", {})
        urgency_ans = answers.get("urgency", {})

        lane_choice = lane_ans.get("choice", "fast_social")
        lane_probs = lane_ans.get("probabilities", {})

        # System 1 Reflex Gate: fast_social reflex triggers immediate action,
        # while specialist, persistent_goal, large_council, and file_search escalate to System 2
        is_reflex = (lane_choice == "fast_social")
        act_choice = "act_immediately" if is_reflex else "escalate_system2"
        social_prob = lane_probs.get("fast_social", 0.0)
        escalate_prob = round(1.0 - social_prob, 4)

        return web.json_response({
            "lane": lane_choice,
            "lane_confidence": lane_ans.get("confidence", 0.0),
            "lane_probabilities": lane_probs,
            "act_vs_escalate": act_choice,
            "act_confidence": round(abs(social_prob - 0.5) * 2, 4),
            "act_probabilities": {
                "act_immediately": social_prob,
                "escalate_system2": escalate_prob
            },
            "is_safe": safety_ans.get("choice") != "yes",
            "safety_confidence": safety_ans.get("confidence", 1.0),
            "urgency_score": urgency_ans.get("score", 0.5),
            "latency_ms": round(latency_ms, 2)
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e), "latency_ms": (time.perf_counter() - t0) * 1000}, status=500)


async def handle_memory_rerank(request: web.Request) -> web.Response:
    """
    Bidirectional Memory Arbiter:
    Evaluates candidate memories against query and state.
    Solves 'memory that argues with itself' by detecting contradictions and supersessions.
    """
    if AGENT is None:
        return web.json_response({"error": "Model not initialized"}, status=503)

    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    query = str(body.get("query", "")).strip()
    candidates = body.get("candidates", [])
    state_ctx = body.get("state", {})

    if not candidates:
        return web.json_response({"results": [], "conflicts_resolved": 0, "latency_ms": 0.0})

    # Limit to top 15 candidates for sub-50ms latency
    cands_to_eval = candidates[:15]
    loop = asyncio.get_event_loop()

    # 1. Score each candidate's relevance & utility to query
    questions_per_candidate = {}
    for idx, c in enumerate(cands_to_eval):
        cid = c.get("id") or f"cand_{idx}"
        content_snippet = str(c.get("content", ""))[:220]
        questions_per_candidate[f"rel_{idx}"] = {
            "type": "score",
            "instructions": f"How relevant and useful is memory [{content_snippet}] for query [{query}]?",
            "criteria": ["irrelevant", "somewhat relevant", "directly answers or grounds query"]
        }

    state = {
        "query": query,
        "context": state_ctx
    }

    try:
        res = await run_predict_safe(loop, state, questions_per_candidate)
        answers = res.get("answers", {})

        scored_candidates = []
        for idx, c in enumerate(cands_to_eval):
            score_data = answers.get(f"rel_{idx}", {})
            rel_score = float(score_data.get("score", 0.5))
            c_copy = dict(c)
            c_copy["system1_relevance"] = rel_score
            c_copy["system1_confidence"] = float(score_data.get("confidence", 0.5))
            c_copy["authoritative"] = True
            c_copy["superseded"] = False
            scored_candidates.append(c_copy)

        # 2. Contradiction & Supersession resolution across pairs of top candidates
        # If the top candidates share keywords or topics, evaluate bidirectional cross-attention
        conflicts_resolved = 0
        if len(scored_candidates) >= 2:
            # Sort preliminarily by relevance
            scored_candidates.sort(key=lambda x: x["system1_relevance"], reverse=True)
            top_pairs = min(len(scored_candidates), 4)

            pair_questions = {}
            pair_map = []
            for i in range(top_pairs):
                for j in range(i + 1, top_pairs):
                    c_a = scored_candidates[i]
                    c_b = scored_candidates[j]
                    q_key = f"pair_{i}_{j}"
                    pair_questions[q_key] = {
                        "type": "choice",
                        "instructions": (
                            f"Given Query '{query}', statement A: '{c_a.get('content', '')[:120]}' "
                            f"and statement B: '{c_b.get('content', '')[:120]}'. "
                            "Do they contradict, and which is authoritative?"
                        ),
                        "criteria": {
                            "compatible": "both are compatible or describe different aspects",
                            "a_supersedes_b": "A is the updated or authoritative truth; B is outdated or incorrect",
                            "b_supersedes_a": "B is the updated or authoritative truth; A is outdated or incorrect"
                        }
                    }
                    pair_map.append((q_key, i, j))

            if pair_questions:
                pair_res = await run_predict_safe(loop, state, pair_questions)
                pair_answers = pair_res.get("answers", {})

                for q_key, i, j in pair_map:
                    ans = pair_answers.get(q_key, {})
                    choice = ans.get("choice")
                    if choice == "a_supersedes_b":
                        scored_candidates[j]["superseded"] = True
                        scored_candidates[j]["authoritative"] = False
                        scored_candidates[j]["system1_relevance"] *= 0.35
                        conflicts_resolved += 1
                    elif choice == "b_supersedes_a":
                        scored_candidates[i]["superseded"] = True
                        scored_candidates[i]["authoritative"] = False
                        scored_candidates[i]["system1_relevance"] *= 0.35
                        conflicts_resolved += 1

        # Final sort: authoritative first, then by system1_relevance
        scored_candidates.sort(
            key=lambda x: (1 if x["authoritative"] else 0, x["system1_relevance"]),
            reverse=True
        )

        latency_ms = (time.perf_counter() - t0) * 1000
        return web.json_response({
            "results": scored_candidates,
            "conflicts_resolved": conflicts_resolved,
            "latency_ms": round(latency_ms, 2)
        })
    except Exception as e:
        return web.json_response({"error": str(e), "latency_ms": (time.perf_counter() - t0) * 1000}, status=500)


async def handle_memory_ingest(request: web.Request) -> web.Response:
    """
    Memory Ingestion Filter:
    Evaluates new observation for novelty, contradiction with core knowledge, and target tier.
    """
    if AGENT is None:
        return web.json_response({"error": "Model not initialized"}, status=503)

    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    content = str(body.get("content", "")).strip()
    metadata = body.get("metadata", {})

    state = {
        "content": content,
        "metadata": metadata
    }

    questions = {
        "novelty": {
            "type": "noul",
            "instructions": "Does this text contain novel, substantive, non-redundant information?"
        },
        "contradiction": {
            "type": "noul",
            "instructions": "Does this statement contradict established common sense or core facts?"
        },
        "target_tier": {
            "type": "choice",
            "instructions": "Which memory storage tier should retain this observation?",
            "criteria": {
                "hot": "immediate active context required across near-term dialogue",
                "warm": "valuable episodic or semantic knowledge worth indexing in vector memory",
                "cold": "archival reference or low-frequency detail for persistent SQLite store",
                "discard_noise": "ephemeral chatter, filler, or meaningless redundancy"
            }
        },
        "importance": {
            "type": "score",
            "instructions": "How important is this information for long-term retention?",
            "criteria": ["trivial chatter", "useful context", "critical system invariant or core truth"]
        }
    }

    try:
        loop = asyncio.get_event_loop()
        res = await run_predict_safe(loop, state, questions)
        answers = res.get("answers", {})

        novelty_ans = answers.get("novelty", {})
        contradiction_ans = answers.get("contradiction", {})
        tier_ans = answers.get("target_tier", {})
        imp_ans = answers.get("importance", {})

        is_novel = novelty_ans.get("noul", 0.0) >= 0.5
        is_contradiction = contradiction_ans.get("noul", 0.0) >= 0.5
        suggested_tier = tier_ans.get("choice", "warm")
        importance_score = imp_ans.get("score", 0.5)

        # Ingestion recommendation: discard if marked as discard_noise or contradictory
        should_ingest = (suggested_tier != "discard_noise") and not is_contradiction

        latency_ms = (time.perf_counter() - t0) * 1000
        return web.json_response({
            "should_ingest": should_ingest,
            "is_novel": is_novel,
            "novelty_confidence": novelty_ans.get("confidence", 0.5),
            "is_contradiction": is_contradiction,
            "contradiction_confidence": contradiction_ans.get("confidence", 0.5),
            "suggested_tier": suggested_tier,
            "importance": importance_score,
            "latency_ms": round(latency_ms, 2)
        })
    except Exception as e:
        return web.json_response({"error": str(e), "latency_ms": (time.perf_counter() - t0) * 1000}, status=500)


async def handle_distill_record(request: web.Request) -> web.Response:
    """
    Closed-Loop Distillation:
    Appends System 2 execution outcome receipts to local experience dataset for RLCD training.
    """
    t0 = time.perf_counter()
    try:
        receipt = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    receipt["timestamp"] = receipt.get("timestamp", time.time())
    os.makedirs(DATA_DIR, exist_ok=True)

    try:
        with open(EXPERIENCE_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(receipt, ensure_ascii=False) + "\n")
        return web.json_response({
            "recorded": True,
            "file": EXPERIENCE_FILE,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2)
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_trading_decision(request: web.Request) -> web.Response:
    """
    BeeBots / Algorithmic Trading Decision Gate:
    Evaluates market indicator state against an operational decision menu and scores conviction.
    Schema matches BeeBots / TypeSafe AI Jev:
      - strategy: instructions
      - state: dictionary of market metrics (1h return, RSI, %B, ATR, etc.)
      - menu: { "ACTION_KEY": "description or null", ... }
      - conviction_labels: ["none", "weak", "moderate", "strong"]
    """
    if AGENT is None:
        return web.json_response({"error": "Model not initialized"}, status=503)

    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    strategy = body.get("strategy", "Select the optimal trading action given current market metrics.")
    state = body.get("state", {})
    menu = body.get("menu", {})
    conviction_labels = body.get("conviction_labels", ["none", "weak", "moderate", "strong"])

    if not menu:
        return web.json_response({"error": "Menu cannot be empty"}, status=400)

    criteria = {}
    for k, v in menu.items():
        if isinstance(v, dict):
            criteria[k] = v.get("desc") or k
        elif isinstance(v, str):
            criteria[k] = v
        else:
            criteria[k] = k

    questions = {
        "action": {
            "type": "choice",
            "instructions": f"{strategy} Pick your next move.",
            "criteria": criteria
        },
        "conviction": {
            "type": "score",
            "instructions": "Signal strength?",
            "criteria": conviction_labels
        }
    }

    try:
        loop = asyncio.get_event_loop()
        async with PREDICT_LOCK:
            res = await run_predict_safe(loop, state, questions)
        latency_ms = (time.perf_counter() - t0) * 1000

        answers = res.get("answers", {})
        action_ans = answers.get("action", {})
        conviction_ans = answers.get("conviction", {})

        choice = action_ans.get("choice")
        probabilities = action_ans.get("probabilities", {})
        confidence = action_ans.get("confidence", 0.0)

        conviction_score = conviction_ans.get("score", 0.0)
        conviction_level = max(0, min(len(conviction_labels) - 1, round(conviction_score)))

        return web.json_response({
            "ok": True,
            "choice": choice,
            "probabilities": probabilities,
            "confidence": confidence,
            "conviction": conviction_level,
            "conviction_raw": round(conviction_score, 4),
            "latency_ms": round(latency_ms, 2)
        })
    except Exception as e:
        return web.json_response({"error": str(e), "latency_ms": (time.perf_counter() - t0) * 1000}, status=500)


async def handle_trading_batch(request: web.Request) -> web.Response:
    """
    Batch BeeBots decision gate: evaluates all bees in a single locked transaction.
    Schema:
      {
        "bees": {
          "bizzy": { "strategy": "...", "state": {...}, "menu": {...}, "conviction_labels": [...] },
          "boozy": { "strategy": "...", "state": {...}, "menu": {...}, "conviction_labels": [...] },
          "breezy": { "strategy": "...", "state": {...}, "menu": {...}, "conviction_labels": [...] }
        }
      }
    """
    if AGENT is None:
        return web.json_response({"error": "Model not initialized"}, status=503)

    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    bees_input = body.get("bees", {})
    if not bees_input:
        return web.json_response({"error": "No bees provided"}, status=400)

    results = {}
    loop = asyncio.get_event_loop()
    async with PREDICT_LOCK:
        for bee_key, bee_data in bees_input.items():
            strategy = bee_data.get("strategy", "Select optimal trading action.")
            state = bee_data.get("state", {})
            menu = bee_data.get("menu", {})
            conviction_labels = bee_data.get("conviction_labels", ["none", "weak", "moderate", "strong"])

            criteria = {}
            for k, v in menu.items():
                if isinstance(v, dict):
                    criteria[k] = v.get("desc") or k
                elif isinstance(v, str):
                    criteria[k] = v
                else:
                    criteria[k] = k

            questions = {
                "action": {
                    "type": "choice",
                    "instructions": f"{strategy} Pick your next move.",
                    "criteria": criteria
                },
                "conviction": {
                    "type": "score",
                    "instructions": "Signal strength?",
                    "criteria": conviction_labels
                }
            }

            try:
                res = await run_predict_safe(loop, state, questions)
                answers = res.get("answers", {})
                action_ans = answers.get("action", {})
                conviction_ans = answers.get("conviction", {})

                choice = action_ans.get("choice")
                probabilities = action_ans.get("probabilities", {})
                confidence = action_ans.get("confidence", 0.0)

                conviction_score = conviction_ans.get("score", 0.0)
                conviction_level = max(0, min(len(conviction_labels) - 1, round(conviction_score)))

                results[bee_key] = {
                    "ok": True,
                    "choice": choice,
                    "probabilities": probabilities,
                    "confidence": confidence,
                    "conviction": conviction_level,
                    "conviction_raw": round(conviction_score, 4)
                }
            except Exception as e:
                results[bee_key] = {"ok": False, "error": str(e)}

    latency_ms = (time.perf_counter() - t0) * 1000
    return web.json_response({
        "ok": True,
        "results": results,
        "latency_ms": round(latency_ms, 2)
    })


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", handle_health)
    app.router.add_post("/predict/turn_routing", handle_turn_routing)
    app.router.add_post("/predict/memory_rerank", handle_memory_rerank)
    app.router.add_post("/predict/memory_ingest", handle_memory_ingest)
    app.router.add_post("/predict/trading_decision", handle_trading_decision)
    app.router.add_post("/predict/trading_batch", handle_trading_batch)
    app.router.add_post("/distill/record", handle_distill_record)
    return app



if __name__ == "__main__":
    load_laya_agent()
    app = create_app()
    print(f"[System1Substrate] 🚀 Starting HTTP daemon on http://{HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, access_log=None)
