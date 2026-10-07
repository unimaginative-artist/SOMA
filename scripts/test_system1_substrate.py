#!/usr/bin/env python3
"""
test_system1_substrate.py

Comprehensive Automated Verification Suite for SOMA Neocortex System 1 Substrate.
Tests live HTTP endpoints on port 5055 across all 3 cognitive pillars.
"""

import sys
import time
import json
import urllib.request
import urllib.error

# Ensure clean UTF-8 output on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE_URL = "http://127.0.0.1:5055"


def http_post(endpoint: str, data: dict) -> dict:
    url = f"{BASE_URL}{endpoint}"
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get(endpoint: str) -> dict:
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_health():
    print("\n[Test 1] Health & Telemetry Endpoint...")
    res = http_get("/health")
    print("  Response:", json.dumps(res, indent=2))
    assert res.get("status") == "online", f"Expected online, got {res.get('status')}"
    print("  ✅ Health endpoint OK.")


def test_turn_routing():
    print("\n[Test 2] Sensory & Turn Routing Gate...")

    # Case A: Specialist or Council Deliberation (MAX Architecture Audit)
    t0 = time.perf_counter()
    res_spec = http_post("/predict/turn_routing", {
        "text": "Can you analyze MAX architecture and look for weaknesses?",
        "context": {"channel": "discord", "user": "operator"}
    })
    lat_spec = (time.perf_counter() - t0) * 1000
    print(f"  A) 'Can you analyze MAX architecture and look for weaknesses?' -> Lane: {res_spec.get('lane')} (Act: {res_spec.get('act_vs_escalate')}, Latency: {lat_spec:.1f}ms)")
    assert res_spec.get("lane") in ["specialist", "large_council"], f"Expected 'specialist' or 'large_council', got {res_spec.get('lane')}"
    assert res_spec.get("act_vs_escalate") == "escalate_system2", f"Expected 'escalate_system2', got {res_spec.get('act_vs_escalate')}"

    # Case B: Fast Social Reflex (Greeting / Banter)
    t0 = time.perf_counter()
    res_soc = http_post("/predict/turn_routing", {
        "text": "Hey Soma, how are you feeling today?",
        "context": {"channel": "discord", "user": "operator"}
    })
    lat_soc = (time.perf_counter() - t0) * 1000
    print(f"  B) 'Hey Soma, how are you feeling today?' -> Lane: {res_soc.get('lane')} (Act: {res_soc.get('act_vs_escalate')}, Latency: {lat_soc:.1f}ms)")
    assert res_soc.get("lane") == "fast_social", f"Expected 'fast_social', got {res_soc.get('lane')}"
    assert res_soc.get("act_vs_escalate") == "act_immediately", f"Expected 'act_immediately', got {res_soc.get('act_vs_escalate')}"

    # Case C: Persistent Goal or Council (Overnight Task)
    t0 = time.perf_counter()
    res_goal = http_post("/predict/turn_routing", {
        "text": "Run an overnight audit on all trading models until 8am.",
        "context": {"channel": "discord", "user": "operator"}
    })
    lat_goal = (time.perf_counter() - t0) * 1000
    print(f"  C) 'Run an overnight audit on all trading models until 8am.' -> Lane: {res_goal.get('lane')} (Act: {res_goal.get('act_vs_escalate')}, Latency: {lat_goal:.1f}ms)")
    assert res_goal.get("lane") in ["persistent_goal", "large_council"], f"Expected 'persistent_goal' or 'large_council', got {res_goal.get('lane')}"
    assert res_goal.get("act_vs_escalate") == "escalate_system2", f"Expected 'escalate_system2', got {res_goal.get('act_vs_escalate')}"

    print("  ✅ Turn routing tests passed.")


def test_memory_rerank():
    print("\n[Test 3] Bidirectional Memory Arbiter & Contradiction Resolution...")
    payload = {
        "query": "Is paper trading currently active or stopped?",
        "candidates": [
            {
                "id": "cand_old",
                "content": "Paper trading is stopped: zero engines running and no qualified after-cost candidate.",
                "created_at": 1785000000
            },
            {
                "id": "cand_new",
                "content": "Daily Trading Activity Digest: 9x Engine Auto-Resumed: Paper trading on with live execution.",
                "created_at": 1790000000
            }
        ]
    }
    t0 = time.perf_counter()
    res = http_post("/predict/memory_rerank", payload)
    lat = (time.perf_counter() - t0) * 1000
    results = res.get("results", [])
    print(f"  Memory Rerank Latency: {lat:.1f}ms, Conflicts Resolved: {res.get('conflicts_resolved')}")
    for idx, r in enumerate(results):
        print(f"    Rank {idx+1}: [{r.get('id')}] authoritative={r.get('authoritative')} superseded={r.get('superseded')} rel={r.get('system1_relevance'):.3f} - '{r.get('content')[:60]}...'")

    assert len(results) == 2, "Expected 2 candidates evaluated"
    print("  ✅ Memory arbiter tests passed.")


def test_memory_ingest():
    print("\n[Test 4] Memory Ingestion Filter...")

    # Case A: Junk chatter
    res_junk = http_post("/predict/memory_ingest", {
        "content": "ok sounds good thx",
        "metadata": {"source": "chat"}
    })
    print(f"  A) Noise chatter: 'ok sounds good thx' -> should_ingest: {res_junk.get('should_ingest')}, tier: {res_junk.get('suggested_tier')}")
    assert res_junk.get("suggested_tier") == "discard_noise" or not res_junk.get("should_ingest"), "Expected junk to be filtered or tagged discard_noise"

    # Case B: Substantive core invariant
    res_core = http_post("/predict/memory_ingest", {
        "content": "Marionette launcher repairs verified. MAX and SOMA healthy with their bridge up and 115 focused tests passing.",
        "metadata": {"source": "system_receipt"}
    })
    print(f"  B) Core fact: 'Marionette launcher repairs verified...' -> should_ingest: {res_core.get('should_ingest')}, tier: {res_core.get('suggested_tier')}, is_novel: {res_core.get('is_novel')}")
    assert res_core.get("should_ingest") == True, "Expected core fact to be accepted for ingestion"
    assert res_core.get("suggested_tier") in ["warm", "hot", "cold"], "Expected tier to be hot, warm, or cold"

    print("  ✅ Memory ingestion filter tests passed.")


def test_latency_benchmark():
    print("\n[Test 5] Latency & Throughput Benchmark (20 sequential decisions)...")
    latencies = []
    for _ in range(20):
        t0 = time.perf_counter()
        _ = http_post("/predict/turn_routing", {
            "text": "Check status of the system",
            "context": {"channel": "chat"}
        })
        latencies.append((time.perf_counter() - t0) * 1000)

    p50 = sorted(latencies)[len(latencies) // 2]
    p95 = sorted(latencies)[int(len(latencies) * 0.95)]
    print(f"  Min: {min(latencies):.1f}ms | Median (p50): {p50:.1f}ms | p95: {p95:.1f}ms | Max: {max(latencies):.1f}ms")
    assert p50 < 60.0, f"Expected sub-60ms median latency, got {p50:.1f}ms"
    print("  ✅ Latency benchmark passed.")


def main():
    print("=" * 60)
    print(" SOMA System 1 Substrate (Laya) Automated Test Suite")
    print("=" * 60)
    try:
        test_health()
        test_turn_routing()
        test_memory_rerank()
        test_memory_ingest()
        test_latency_benchmark()
        print("\n" + "=" * 60)
        print(" 🎉 ALL TESTS PASSED SUCCESSFULLY!")
        print("=" * 60)
    except urllib.error.URLError as e:
        print(f"\n❌ Connection Error: Cannot connect to {BASE_URL}. Ensure system1_substrate_daemon.py is running. Details: {e}")
        sys.exit(1)
    except AssertionError as e:
        print(f"\n❌ Assertion Failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
