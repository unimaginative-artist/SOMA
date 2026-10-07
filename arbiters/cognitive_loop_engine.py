# cognitive_loop_engine.py
# Cognitive Feedback Loop Engine v1.0
# Single-file drop-in for SOMA / Shared Memory / Warp orchestration
# Author: Assistant (for Owner)
# Requirements: Python 3.10+
# Optional integrations: requests, numpy, faiss, sentence-transformers

import time, threading, json, math, uuid, traceback
from typing import Callable, List, Dict, Any, Optional
from dataclasses import dataclass, field
from copy import deepcopy
from datetime import datetime

# -------------------------
# Utilities
# -------------------------
def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def uid(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"

def safe_repr(x, n=300):
    try:
        s = json.dumps(x, default=str)
    except Exception:
        s = str(x)
    return s[:n] + ("..." if len(s) > n else "")

# -------------------------
# Default In-Memory Broker (pub/sub)
# -------------------------
class InMemoryBroker:
    def __init__(self):
        self.subs = {}
        self.lock = threading.Lock()

    def publish(self, channel: str, message: dict):
        with self.lock:
            cbs = list(self.subs.get(channel, []))
        for cb in cbs:
            try:
                # run callback in thread to avoid blocking
                threading.Thread(target=cb, args=(message,), daemon=True).start()
            except Exception:
                traceback.print_exc()

    def subscribe(self, channel: str, callback: Callable[[dict], None]):
        with self.lock:
            self.subs.setdefault(channel, []).append(callback)

# -------------------------
# Default Minimal SharedMemoryClient Interface (pluggable)
# Must provide: add(text, meta), search(qtext/kembedding), get(id), update(id, patch, version_cas)
# The shared memory you built earlier exposes HTTP endpoints; provide a thin client wrapper.
# -------------------------
class InMemorySharedMemoryClient:
    def __init__(self):
        self.store = {}  # id -> chunk dict
        self.lock = threading.Lock()

    def add(self, text: str, embedding: Optional[List[float]] = None, meta: Optional[Dict]=None, actor: str="system"):
        cid = uid("mem")
        chunk = {
            "id": cid,
            "text": text,
            "embedding": embedding or [],
            "meta": meta or {},
            "created_ts": int(time.time()),
            "updated_ts": int(time.time()),
            "score": 1.0,
            "version": 1
        }
        with self.lock:
            self.store[cid] = chunk
        return deepcopy(chunk)

    def get(self, cid: str):
        with self.lock:
            return deepcopy(self.store.get(cid))

    def update(self, cid: str, text: Optional[str]=None, embedding: Optional[List[float]]=None, meta: Optional[dict]=None, score: Optional[float]=None, version_cas: Optional[int]=None):
        with self.lock:
            if cid not in self.store:
                raise KeyError("not found")
            if version_cas is not None and self.store[cid]["version"] != version_cas:
                raise ValueError("version_mismatch")
            if text is not None:
                self.store[cid]["text"] = text
            if embedding is not None:
                self.store[cid]["embedding"] = embedding
            if meta is not None:
                self.store[cid]["meta"].update(meta)
            if score is not None:
                self.store[cid]["score"] = score
            self.store[cid]["version"] += 1
            self.store[cid]["updated_ts"] = int(time.time())
            return deepcopy(self.store[cid])

    def search(self, qtext: str = "", qembedding: Optional[List[float]] = None, topk: int = 8):
        # naive text substring fallback
        with self.lock:
            items = list(self.store.values())
        results = []
        for it in items:
            score = 0.0
            if qembedding and it.get("embedding"):
                # rough dot product if sizes match
                try:
                    a = qembedding; b = it["embedding"]
                    sm = sum((a[i] if i < len(a) else 0.0) * (b[i] if i < len(b) else 0.0) for i in range(min(len(a), len(b))))
                    score = float(sm)
                except Exception:
                    score = 0.0
            else:
                if qtext and qtext.lower() in (it["text"] or "").lower():
                    score = 1.0
                else:
                    score = 0.0
            results.append( (score, it) )
        results.sort(key=lambda x: -x[0])
        return [ {"id": r[1]["id"], "score": r[0], "chunk": r[1]} for r in results[:topk] ]

# -------------------------
# Embedding provider (pluggable)
# -------------------------
def deterministic_embed(text: str, dim: int = 128):
    # simple deterministic pseudo-embedding: hash bytes -> floats normalized
    import hashlib, struct
    m = hashlib.sha256(text.encode("utf-8")).digest()
    vec = []
    i = 0
    while len(vec) < dim:
        part = m[i % len(m):(i%len(m))+4]
        if len(part) < 4:
            part = part.ljust(4, b'\0')
        v = struct.unpack(">I", part)[0] / 0xFFFFFFFF
        vec.append( (v * 2.0) - 1.0 )
        i += 4
    # normalize
    norm = math.sqrt(sum(x*x for x in vec)) or 1.0
    return [x / norm for x in vec]

# -------------------------
# Data containers
# -------------------------
@dataclass
class ThoughtState:
    id: str = field(default_factory=lambda: uid("thought"))
    actor: str = "soma"
    input_text: str = ""
    rounds: List[Dict[str,Any]] = field(default_factory=list)
    created: str = field(default_factory=now_iso)
    final_output: Optional[Dict[str,Any]] = None
    confidence: float = 0.0

# -------------------------
# Causal Graph Engine (lightweight)
# - nodes: events/concepts
# - edges: cause -> effect with weight
# - small Bayesian-ish update for edge strength
# -------------------------
class CausalGraph:
    def __init__(self):
        self.nodes = {}  # id -> {"label":..., "meta":...}
        self.edges = {}  # (a,b) -> weight (0..1)
        self.lock = threading.Lock()

    def add_node(self, nid: str, label: str, meta: Optional[dict]=None):
        with self.lock:
            self.nodes[nid] = {"label": label, "meta": meta or {}, "ts": now_iso()}

    def add_edge(self, a: str, b: str, weight: float = 0.5):
        with self.lock:
            k = (a,b)
            self.edges[k] = max(0.0, min(1.0, float(weight)))

    def observe(self, a: str, b: str, success: bool):
        # increase weight if observed success, decrease otherwise
        with self.lock:
            k = (a,b)
            prev = self.edges.get(k, 0.5)
            alpha = 0.1
            if success:
                new = prev + alpha * (1.0 - prev)
            else:
                new = prev - alpha * (prev)
            self.edges[k] = max(0.0,min(1.0,new))
            return self.edges[k]

    def predict(self, a: str, threshold: float = 0.5):
        with self.lock:
            res = []
            for (x,y), w in self.edges.items():
                if x == a and w >= threshold:
                    res.append( (y,w) )
            res.sort(key=lambda t:-t[1])
            return res

# -------------------------
# Conflict Detector & Consistency Scorer
# - Compares new candidate facts against retrieved memory and scores consistency
# -------------------------
class ConflictDetector:
    def __init__(self, similarity_threshold: float = 0.6):
        self.similarity_threshold = similarity_threshold

    def score_consistency(self, candidate_text: str, memory_chunks: List[dict]) -> Dict[str,Any]:
        """
        Very lightweight heuristic:
         - counts contradictions by substring negations or explicit "not"/"never"
         - uses embedding dot product if embeddings provided
        Returns: {"consistency_score": 0..1, "conflicts": [chunk_ids], "support": [chunk_ids]}
        """
        # simple heuristics
        support = []
        conflicts = []
        score = 0.5
        cand_lower = candidate_text.lower()
        for c in memory_chunks:
            text = (c.get("text") or "").lower()
            # exact contradiction heuristics (naive)
            if ("not " + text) in cand_lower or ("no " + text) in cand_lower:
                conflicts.append(c["id"])
            elif text and text in cand_lower:
                support.append(c["id"])
            else:
                # embedding similarity if available
                if c.get("embedding") and len(c["embedding"])>0:
                    try:
                        # cosine
                        a = deterministic_embed(candidate_text, dim=len(c["embedding"]))
                        b = c["embedding"]
                        num = sum(a[i]*b[i] for i in range(min(len(a),len(b))))
                        den = (math.sqrt(sum(x*x for x in a))*math.sqrt(sum(x*x for x in b))) or 1.0
                        sim = num/den
                        if sim >= self.similarity_threshold:
                            support.append(c["id"])
                        elif sim <= (1 - self.similarity_threshold):
                            conflicts.append(c["id"])
                    except Exception:
                        pass
        # heuristic scoring
        if support and not conflicts:
            score = min(0.95, 0.6 + 0.1*len(support))
        elif conflicts and not support:
            score = max(0.05, 0.4 - 0.1*len(conflicts))
        elif support and conflicts:
            score = 0.5 * (0.6 + 0.1*len(support)) + 0.5 * (0.4 - 0.1*len(conflicts))
        else:
            score = 0.5  # uncertain
        score = max(0.01, min(0.99, score))
        return {"consistency_score": score, "conflicts": conflicts, "support": support}

# -------------------------
# Grounded Imagination / Simulation Module
# - generates hypotheses or alternative interpretations
# - user can plug in LLM or model for creative sim; fallback uses simple transforms
# -------------------------
class Simulator:
    def __init__(self, creative_fn: Optional[Callable[[str,int], List[str]]] = None):
        # creative_fn(text, n) -> [hypothesis strings]
        self.creative_fn = creative_fn

    def generate_hypotheses(self, prompt: str, n: int = 3) -> List[str]:
        if self.creative_fn:
            try:
                return self.creative_fn(prompt, n)
            except Exception:
                pass
        # fallback cheap variants: paraphrases / negations
        out = []
        out.append(prompt)
        out.append("Possible alternate interpretation: " + prompt + " (with emphasis on causality)")
        out.append("Counterfactual: if NOT (" + prompt + "), then ...")
        return out[:n]

# -------------------------
# Reflective Reasoner (controls iterative loop)
# -------------------------
class ReflectiveReasoner:
    def __init__(self,
                 shared_memory_client,
                 broker,
                 embedding_fn: Callable[[str], List[float]] = deterministic_embed,
                 max_rounds: int = 4,
                 search_topk: int = 6,
                 confidence_threshold: float = 0.75,
                 autosave: bool = True):
        self.shared_memory = shared_memory_client
        self.broker = broker
        self.embedding_fn = embedding_fn
        self.max_rounds = max_rounds
        self.search_topk = search_topk
        self.confidence_threshold = confidence_threshold
        self.autosave = autosave

        self.conflict_detector = ConflictDetector()
        self.simulator = Simulator()
        self.causal = CausalGraph()

    def think(self, actor: str, input_text: str, context: Optional[Dict]=None, timeout: float = 10.0) -> ThoughtState:
        """
        Orchestrates multi-round internal thinking.
        Returns ThoughtState containing rounds, final_output, confidence.
        """
        start_ts = time.time()
        state = ThoughtState(actor=actor, input_text=input_text)
        # initial embedding & retrieval
        emb = None
        try:
            emb = self.embedding_fn(input_text)
        except Exception:
            emb = deterministic_embed(input_text)
        retrieved = []
        try:
            retrieved = self.shared_memory.search(input_text, qembedding=emb, topk=self.search_topk)
        except Exception:
            # attempt text-only
            try:
                retrieved = self.shared_memory.search(input_text, qtext=input_text, topk=self.search_topk)
            except Exception:
                retrieved = []

        # start rounds
        candidate = {"text": input_text, "meta": {"source": actor}}
        for r in range(self.max_rounds):
            round_info = {"round": r+1, "timestamp": now_iso(), "candidate": candidate, "evidence": [], "consistency": None, "hypotheses": [], "decision": None}
            # 1) Ground candidate with memory evidence
            mems = [m["chunk"] for m in retrieved] if retrieved else []
            round_info["evidence"] = [ {"id": m["id"], "text": (m.get("text") or "")[:200]} for m in mems ]

            # 2) Consistency scoring
            cons = self.conflict_detector.score_consistency(candidate["text"], mems)
            round_info["consistency"] = cons

            # 3) Generate alternative hypotheses (simulation)
            hyps = self.simulator.generate_hypotheses(candidate["text"], n=3)
            round_info["hypotheses"] = hyps

            # 4) Evaluate hypotheses quickly: score against memory
            hyp_scores = []
            for h in hyps:
                try:
                    h_emb = self.embedding_fn(h)
                except Exception:
                    h_emb = deterministic_embed(h)
                try:
                    hits = self.shared_memory.search(h, qembedding=h_emb, topk=4)
                except Exception:
                    hits = []
                sc = self.conflict_detector.score_consistency(h, [hh["chunk"] for hh in hits])
                hyp_scores.append( {"hyp":h, "score": sc["consistency_score"], "support": sc["support"], "conflicts": sc["conflicts"]} )

            # 5) Combine candidate confidence from cons + hyp evidence
            cand_conf = cons["consistency_score"]
            # boost if any hypothesis has significantly higher score
            best_h = max(hyp_scores, key=lambda x: x["score"], default=None)
            if best_h and best_h["score"] > cand_conf + 0.12:
                # adopt best hypothesis as new candidate sometimes
                candidate = {"text": best_h["hyp"], "meta": {"derived_from": candidate["text"], "adopted_round": r+1}}
                cand_conf = best_h["score"] * 0.9
                round_info["decision"] = f"adopted_hypothesis_{candidate['meta']['adopted_round']}"
            else:
                round_info["decision"] = "retain_candidate"

            # 6) Causal inference: try to link candidate to causal nodes
            # naive: add node and observe predictions
            node_id = uid("node")
            self.causal.add_node(node_id, label=candidate["text"])
            preds = self.causal.predict(node_id, threshold=0.2)

            # 7) Logging round
            state.rounds.append(round_info)
            state.confidence = cand_conf

            # 8) termination check
            if cand_conf >= self.confidence_threshold:
                state.final_output = {"text": candidate["text"], "reason": "confidence_reached", "confidence": cand_conf}
                break

            # check time budget
            if time.time() - start_ts > timeout:
                state.final_output = {"text": candidate["text"], "reason": "timeout", "confidence": cand_conf}
                break

            # otherwise iterate: retrieve again using candidate
            try:
                emb = self.embedding_fn(candidate["text"])
            except Exception:
                emb = deterministic_embed(candidate["text"])
            try:
                retrieved = self.shared_memory.search(candidate["text"], qembedding=emb, topk=self.search_topk)
            except Exception:
                retrieved = self.shared_memory.search(candidate["text"], qtext=candidate["text"], topk=self.search_topk)

        # after loop: possibly store as memory (tentative or confirmed)
        if self.autosave:
            try:
                meta = {"source": actor, "confidence": state.confidence, "created": now_iso()}
                chunk = self.shared_memory.add(state.final_output["text"] if state.final_output else candidate["text"], embedding=emb, meta=meta, actor=actor)
                state.final_output["stored_id"] = chunk["id"]
            except Exception:
                pass

        # publish thought trace for observability
        try:
            self.broker.publish("cognition.trace", {"actor": actor, "thought_id": state.id, "summary": safe_repr(state.final_output), "confidence": state.confidence, "ts": now_iso()})
        except Exception:
            pass

        return state

# -------------------------
# High-level Cognitive Loop Manager
# - Accepts incoming sensory / query events
# - Runs ReflectiveReasoner for each and integrates with shared memory and causal graph updates
# -------------------------
class CognitiveLoopManager:
    def __init__(self,
                 shared_memory_client = None,
                 broker = None,
                 embedding_fn: Callable[[str], List[float]] = deterministic_embed,
                 max_workers: int = 4):
        self.broker = broker or InMemoryBroker()
        self.shared_memory = shared_memory_client or InMemorySharedMemoryClient()
        self.embedding_fn = embedding_fn
        self.reasoner = ReflectiveReasoner(self.shared_memory, self.broker, embedding_fn=self.embedding_fn)
        self.max_workers = max_workers
        self.queue = []
        self.lock = threading.Lock()
        self.threads = []
        self.running = False

        # subscribe to default channel for inputs
        self.broker.subscribe("perception.input", self._on_input)

    def start(self):
        self.running = True
        for i in range(self.max_workers):
            t = threading.Thread(target=self._worker_loop, daemon=True)
            t.start()
            self.threads.append(t)

    def stop(self):
        self.running = False
        for t in self.threads:
            t.join(timeout=1)

    def _on_input(self, message: dict):
        # expected keys: actor, text, context
        with self.lock:
            self.queue.append(message)

    def submit(self, actor: str, text: str, context: Optional[dict] = None):
        msg = {"actor": actor, "text": text, "context": context or {}, "ts": now_iso()}
        # publish to broker as well for distributed systems
        try:
            self.broker.publish("perception.input", msg)
        except Exception:
            pass
        with self.lock:
            self.queue.append(msg)

    def _worker_loop(self):
        while True:
            if not self.running:
                time.sleep(0.05)
                continue
            item = None
            with self.lock:
                if self.queue:
                    item = self.queue.pop(0)
            if not item:
                time.sleep(0.05)
                continue
            try:
                # run reasoner with a timeout and capture result
                state = self.reasoner.think(item.get("actor","unknown"), item.get("text",""), context=item.get("context",{}), timeout=8.0)
                # publish result
                self.broker.publish("perception.result", {"actor": item.get("actor"), "thought": {"id": state.id, "final": state.final_output}, "confidence": state.confidence, "rounds": len(state.rounds)})
                # if low confidence, route for external check (e.g., DeepSeek)
                if state.confidence < 0.45:
                    self.broker.publish("perception.low_confidence", {"actor": item.get("actor"), "thought_id": state.id, "text": item.get("text")})
                # if conflict heavy, publish
                conflicts = []
                for r in state.rounds:
                    if r.get("consistency") and r["consistency"].get("conflicts"):
                        conflicts.extend(r["consistency"]["conflicts"])
                if conflicts:
                    self.broker.publish("perception.conflict", {"actor": item.get("actor"), "thought_id": state.id, "conflicts": conflicts})
            except Exception as e:
                traceback.print_exc()
                try:
                    self.broker.publish("perception.error", {"error": str(e), "ts": now_iso(), "item": safe_repr(item)})
                except Exception:
                    pass

# -------------------------
# Example Usage (run as script)
# -------------------------
if __name__ == "__main__":
    print("Cognitive Feedback Loop Engine — Demo startup")
    broker = InMemoryBroker()
    sm = InMemorySharedMemoryClient()

    # simple observability subscriber
    def on_result(msg):
        print("[broker] perception.result:", safe_repr(msg))
    broker.subscribe("perception.result", on_result)

    # Create manager and start
    mgr = CognitiveLoopManager(shared_memory_client=sm, broker=broker)
    mgr.start()

    # Seed some memories
    sm.add("The speed of light in vacuum is 299792458 m/s.", embedding=deterministic_embed("speed of light"))
    sm.add("Black cumin seed oil has antioxidant properties; clinical evidence is mixed.", embedding=deterministic_embed("black cumin seed"))
    sm.add("Snake venom is toxic but components have been studied for targeted therapies.", embedding=deterministic_embed("snake venom"))

    # Submit queries
    mgr.submit("user_alice", "How fast does light travel?")
    mgr.submit("user_bob", "I heard black cumin seed oil cures cancer. Is that right?")
    mgr.submit("user_charlie", "Could snake venom be used to target cancer cells?")

    # run for a short while to let workers process
    time.sleep(3.5)
    print("Demo finished — stop manager")
    mgr.stop()
