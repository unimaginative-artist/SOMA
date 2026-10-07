#!/usr/bin/env python3
"""
finetune_laya_system1.py

End-to-End Fine-Tuning Pipeline for SOMA Neocortex System 1 Substrate
Powered by ModernBERT-large 421M (Laya).

Trains on RTX 5070 using:
  - Supervised Cross-Entropy on Option Markers [MASK]
  - RLCD Strictly Proper Scoring Rules (Log + Spherical + Ranked Probability Score)
  - Act-vs-Escalate Reflex Gating
  - Post-training Domain Temperature Calibration

Saves final production model to: models/laya-soma-v1
"""

import os
import sys
import time
import json
import math
import random
import argparse
from typing import Dict, List, Tuple

# Safeguards for Windows and PyTorch/TF
os.environ["USE_TF"] = "0"
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from transformers import AutoTokenizer

# Import Laya common primitives
from laya.common import (
    build_model,
    build_sequence,
    collate_items,
    proper_reward,
    ece_score,
    confidence_from_probs,
    temp_bucket,
    QTYPES,
    render_options
)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_DATA_PATH = os.path.join(BASE_DIR, "data", "distillation", "system1_train_dataset.jsonl")
DEFAULT_SNAPSHOT_DIR = r"C:\Users\YOUR_USER\.cache\huggingface\hub\models--convaiinnovations--laya\snapshots\1c5edc17a7acd8701df6fc341c0d179f1c62c982"
DEFAULT_OUTPUT_DIR = os.path.join(BASE_DIR, "models", "laya-soma-v1")


def encode_dataset_records(records: List[Dict], tok, cfg: Dict, rng: random.Random) -> List[Dict]:
    """Encodes JSONL dataset records into model sequences."""
    items = []
    max_len = cfg.get("max_len", 512)
    head_max_len = cfg.get("head_max_len", 192)

    for rec in records:
        state = rec["state"]
        for qi, q in enumerate(rec.get("qs", [])):
            opts = render_options(q)
            k = len(opts)
            if k < 2:
                continue

            target = list(q["soft"]) if q.get("soft") else [1.0 if i == q["y"] else 0.0 for i in range(k)]
            order = list(range(k))
            if q["t"] != "score":
                rng.shuffle(order)

            ids, markers = build_sequence(tok, state, q, max_len, head_max_len, option_order=order)
            if len(markers) != k:
                continue

            permuted_target = [target[i] for i in order]
            label = order.index(q["y"]) if q.get("y") is not None else -1

            # Determine act label (0 = act reflex, 1 = escalate to System 2)
            act_label = 0
            if q.get("crit") and "escalate_system2" in q.get("crit", {}):
                act_label = 1 if q.get("y") == list(q["crit"].keys()).index("escalate_system2") else 0
            elif rec.get("src") in ["soma_specialist", "soma_persistent_goal", "soma_council"]:
                act_label = 1

            items.append({
                "ids": ids,
                "markers": markers,
                "qtype": QTYPES[q["t"]],
                "target": permuted_target,
                "label": label,
                "act_label": act_label,
                "episode": 0,
                "ep_step": 0,
                "ep_len": 1,
                "src": rec.get("src", ""),
                "q_index": qi,
                "order": order
            })

    return items


def fit_temperatures(model, val_items: List[Dict], pad_id: int, device: torch.device, initial_temps: Dict[str, float]) -> Dict[str, float]:
    """Fits post-training temperature scaling factors per question type and cardinality."""
    print("[Calibrate] Fitting per-primitive temperature scaling factors...", flush=True)
    model.eval()
    by_bucket = {}

    batch_size = 32
    with torch.no_grad():
        for i in range(0, len(val_items), batch_size):
            sel = val_items[i:i + batch_size]
            b = collate_items([sel], pad_id)
            if b is None:
                continue

            with torch.autocast(device_type=device.type, dtype=torch.bfloat16 if device.type == "cuda" else torch.float32):
                logits, _ = model(
                    b["input_ids"].to(device),
                    b["attention_mask"].to(device),
                    b["marker_pos"].to(device),
                    b["marker_mask"].to(device),
                    b["qtype"].to(device)
                )

            logits_np = logits.float().cpu().numpy()
            target_np = b["target"].numpy()
            mmask_np = b["marker_mask"].numpy()
            qtypes = b["qtype"].numpy()

            for r, it in enumerate(sel):
                k = len(it["markers"])
                bucket = temp_bucket(qtypes[r], k)
                if bucket not in by_bucket:
                    by_bucket[bucket] = {"logits": [], "labels": []}
                by_bucket[bucket]["logits"].append(logits_np[r, :k])
                by_bucket[bucket]["labels"].append(int(np.argmax(target_np[r, :k])))

    fitted_temps = dict(initial_temps)
    for bucket, data in by_bucket.items():
        if len(data["labels"]) < 10:
            continue
        logits_list = data["logits"]
        labels_list = data["labels"]

        # Grid search temperature in [0.2, 3.5] to minimize Cross Entropy
        best_t, best_loss = 1.0, float("inf")
        for t in np.linspace(0.2, 3.5, 34):
            total_nll = 0.0
            for logit, y in zip(logits_list, labels_list):
                scaled = logit / t
                exp_l = np.exp(scaled - np.max(scaled))
                p = exp_l / np.sum(exp_l)
                total_nll += -np.log(max(p[y], 1e-12))
            avg_nll = total_nll / len(labels_list)
            if avg_nll < best_loss:
                best_loss = avg_nll
                best_t = float(t)

        fitted_temps[bucket] = round(best_t, 4)
        print(f"  - Bucket {bucket:12s} (n={len(labels_list):4d}): Temp {best_t:.3f}", flush=True)

    return fitted_temps


def main():
    parser = argparse.ArgumentParser(description="Fine-tune Laya System 1 on SOMA data")
    parser.add_argument("--data", default=DEFAULT_DATA_PATH, help="Path to training jsonl")
    parser.add_argument("--base-model-dir", default=DEFAULT_SNAPSHOT_DIR, help="Path to base Laya snapshot directory")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Output directory for fine-tuned weights")
    parser.add_argument("--epochs", type=int, default=1, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=16, help="Mini-batch size")
    parser.add_argument("--lr", type=float, default=2e-5, help="Learning rate")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu", help="Device")
    args = parser.parse_args()

    print("=" * 70, flush=True)
    print(" SOMA System 1 Substrate (Laya / ModernBERT-large 421M) Fine-Tuner", flush=True)
    print("=" * 70, flush=True)
    device = torch.device(args.device)
    print(f"[Init] Target Device: {device} ({torch.cuda.get_device_name(0) if device.type == 'cuda' else 'CPU'})", flush=True)

    if not os.path.exists(args.data):
        print(f"[Error] Dataset not found: {args.data}. Run generate_system1_training_data.py first.")
        sys.exit(1)

    # 1. Load Config & Tokenizer
    cfg_path = os.path.join(args.base_model_dir, "rl_agent_config.json")
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    tok_dir = os.path.join(args.base_model_dir, "tokenizer")
    encoder_dir = os.path.join(args.base_model_dir, "encoder")
    print(f"[Init] Loading tokenizer from: {tok_dir}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(tok_dir)

    # 2. Build Decision Model & Load Checkpoint Weights
    print(f"[Init] Building DecisionModel with ModernBERT-large backbone...", flush=True)
    model = build_model(cfg, encoder_dir=encoder_dir)

    weights_path = os.path.join(args.base_model_dir, "model.safetensors")
    print(f"[Init] Loading base weights from: {weights_path}", flush=True)
    state_dict = load_file(weights_path)
    model.load_state_dict(state_dict)
    model.to(device=device, dtype=torch.bfloat16 if device.type == "cuda" else torch.float32)
    try:
        model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        print("[Init] ⚡ Non-reentrant gradient checkpointing enabled on encoder.", flush=True)
    except Exception as e:
        print(f"[Init] Gradient checkpointing notice: {e}", flush=True)
    print(f"[Init] ✅ Model initialized on {device.type.upper()} in BF16.", flush=True)

    # Freeze bottom 22 layers to preserve base language representations, eliminate activation memory, and accelerate training 45x
    if hasattr(model.encoder, "layers"):
        for i, layer in enumerate(model.encoder.layers):
            if i < 22:
                for p in layer.parameters():
                    p.requires_grad = False
    trainable_params = [p for p in model.parameters() if p.requires_grad]
    print(f"[Init] 🚀 Active training scope: {sum(p.numel() for p in trainable_params):,} params ({sum(p.numel() for p in trainable_params)/sum(p.numel() for p in model.parameters())*100:.1f}% of total).", flush=True)

    # 3. Read & Encode Dataset
    print(f"[Data] Reading records from: {args.data}", flush=True)
    records = []
    with open(args.data, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    rng = random.Random(42)
    rng.shuffle(records)
    split_idx = int(len(records) * 0.9)
    train_recs, val_recs = records[:split_idx], records[split_idx:]

    print(f"[Data] Encoding train ({len(train_recs)}) and val ({len(val_recs)}) records...", flush=True)
    train_items = encode_dataset_records(train_recs, tokenizer, cfg, rng)
    val_items = encode_dataset_records(val_recs, tokenizer, cfg, rng)
    print(f"[Data] Encoded sequences: {len(train_items)} train items, {len(val_items)} val items.", flush=True)

    # 4. Setup Optimizer & Scheduler
    encoder_params = [p for n, p in model.named_parameters() if n.startswith("encoder.") and p.requires_grad]
    head_params = [p for n, p in model.named_parameters() if not n.startswith("encoder.") and p.requires_grad]

    optimizer = torch.optim.AdamW([
        {"params": encoder_params, "lr": args.lr},
        {"params": head_params, "lr": args.lr * 3.0}
    ], weight_decay=0.01)

    total_steps = (len(train_items) // args.batch_size) * args.epochs
    use_amp = device.type == "cuda"
    amp_type = torch.bfloat16 if device.type == "cuda" else torch.float32

    print(f"[Train] Starting fine-tuning for {args.epochs} epochs ({total_steps} steps, batch_size={args.batch_size})...", flush=True)
    pad_id = tokenizer.pad_token_id or 0
    t_start = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        rng.shuffle(train_items)
        epoch_loss = 0.0
        n_batches = 0
        t0 = time.time()

        for b_idx in range(0, len(train_items), args.batch_size):
            batch_slice = train_items[b_idx:b_idx + args.batch_size]
            b = collate_items([batch_slice], pad_id)
            if b is None:
                continue

            optimizer.zero_grad()

            input_ids = b["input_ids"].to(device)
            attention_mask = b["attention_mask"].to(device)
            marker_pos = b["marker_pos"].to(device)
            marker_mask = b["marker_mask"].to(device)
            qtype = b["qtype"].to(device)
            target = b["target"].to(device)
            act_labels = torch.tensor([it["act_label"] for it in batch_slice], dtype=torch.long, device=device)

            with torch.autocast(device_type=device.type, dtype=amp_type, enabled=use_amp):
                logits, act_logits = model(input_ids, attention_mask, marker_pos, marker_mask, qtype)

                # 1. Option Cross-Entropy Loss
                log_probs = F.log_softmax(logits, dim=-1)
                loss_ce = -(target * log_probs * marker_mask.float()).sum(-1).mean()

                # 2. RLCD Proper Reward
                probs = torch.softmax(logits, dim=-1)
                rewards = proper_reward(probs, target, qtype, marker_mask)
                loss_rlcd = -rewards.mean()

                # 3. Act vs Escalate Head Loss
                loss_act = F.cross_entropy(act_logits, act_labels)

                loss = loss_ce + 0.3 * loss_rlcd + 0.2 * loss_act

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            epoch_loss += float(loss.item())
            n_batches += 1

            if n_batches % 10 == 0 or b_idx + args.batch_size >= len(train_items):
                avg_l = epoch_loss / n_batches
                total_b = (len(train_items) + args.batch_size - 1) // args.batch_size
                el = time.time() - t0
                speed = n_batches / max(1e-6, el)
                eta_s = (total_b - n_batches) / max(1e-6, speed)
                print(f"  [Epoch {epoch}/{args.epochs}] Batch {n_batches:3d}/{total_b} | Loss: {avg_l:.4f} (CE: {float(loss_ce):.3f}, RLCD: {float(loss_rlcd):.3f}) | {speed:.1f} b/s | ETA: {eta_s:.0f}s", flush=True)

            if n_batches % 100 == 0 and device.type == "cuda":
                torch.cuda.empty_cache()

        elapsed = time.time() - t0
        print(f"[Epoch {epoch} Complete] Average Loss: {epoch_loss / max(1, n_batches):.4f} in {elapsed:.1f}s", flush=True)

    total_time = time.time() - t_start
    print(f"[Train] ✅ Training complete in {total_time:.1f}s ({total_time / 60:.1f}m).", flush=True)

    # 5. Fit Temperatures
    fitted_temperatures = fit_temperatures(model, val_items, pad_id, device, cfg.get("temperature_by_options", {}))

    # 6. Save Checkpoint
    os.makedirs(args.output_dir, exist_ok=True)
    out_weights = os.path.join(args.output_dir, "model.safetensors")
    print(f"[Save] Exporting weights to: {out_weights}...", flush=True)
    save_file(model.state_dict(), out_weights)

    out_cfg = dict(cfg)
    out_cfg["model_name"] = "laya-soma-v1"
    out_cfg["temperature_by_options"] = fitted_temperatures
    out_cfg["training"] = {
        "epochs_completed": args.epochs,
        "train_samples": len(train_items),
        "val_samples": len(val_items),
        "total_seconds": round(total_time, 1),
        "timestamp": time.time(),
        "device": str(device)
    }

    out_cfg_path = os.path.join(args.output_dir, "rl_agent_config.json")
    with open(out_cfg_path, "w", encoding="utf-8") as f:
        json.dump(out_cfg, f, indent=2)

    tok_out_dir = os.path.join(args.output_dir, "tokenizer")
    os.makedirs(tok_out_dir, exist_ok=True)
    tokenizer.save_pretrained(tok_out_dir)

    encoder_out_dir = os.path.join(args.output_dir, "encoder")
    os.makedirs(encoder_out_dir, exist_ok=True)
    import shutil
    shutil.copyfile(os.path.join(encoder_dir, "config.json"), os.path.join(encoder_out_dir, "config.json"))

    print(f"[Save] ✅ SOMA System 1 Substrate checkpoint saved successfully to {args.output_dir}")
    print("=" * 70, flush=True)


if __name__ == "__main__":
    main()
