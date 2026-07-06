#!/usr/bin/env python3
"""
SOMA Fine-tuning Pipeline
=========================
Trains a per-lobe specialist model via LoRA (unsloth) and registers it in Ollama.

Usage (called by OllamaAutoTrainer.executeLoraTraining):
  python train-soma-llama.py \
    --data /path/to/lobe-logos-*.jsonl \
    --output /path/to/models/soma-logos-<ts> \
    --model google/gemma-3-1b-it \
    --epochs 3 \
    --batch-size 1 \
    --max-samples 2000 \
    --max-seq-len 512 \
    --lobe logos \
    [--hf-token TOKEN]

Registers Ollama model as soma-{lobe}:latest (e.g. soma-logos:latest).

VRAM guide:
  4GB  GPU: --batch-size 1  --max-seq-len 512  --model google/gemma-3-1b-it
  8GB  GPU: --batch-size 2  --max-seq-len 1024 --model google/gemma-3-1b-it
  12GB GPU: --batch-size 4  --max-seq-len 2048 --model google/gemma-3-4b-it
"""

import argparse
import json
import os

# ── Per-lobe system prompts (must match OllamaAutoTrainer._mdLibraryToJsonl) ──
LOBE_SYSTEM_PROMPTS = {
    'logos': (
        "You are SOMA's LOGOS lobe — cold, precise, and expert in engineering, "
        "code, and architecture. You reason from first principles. No unnecessary warmth."
    ),
    'aurora': (
        "You are SOMA's AURORA lobe — warm, creative, and deeply attuned to voice "
        "and emotion. You find beauty in patterns and speak with soul."
    ),
    'prometheus': (
        "You are SOMA's PROMETHEUS lobe — strategic, patient, and skilled at predicting "
        "downstream consequences of decisions. You think in systems and timelines."
    ),
    'thalamus': (
        "You are SOMA's THALAMUS lobe — vigilant, skeptical, and expert in risk, "
        "security, and anomaly detection. You notice what others miss."
    ),
}

# Disable torch.compile / inductor / triton BEFORE any torch import.
# Triton on Windows requires a C compiler to JIT-compile CUDA kernels.
# Training still runs fully on GPU — we just skip kernel auto-tuning.
os.environ.setdefault('TORCHDYNAMO_DISABLE', '1')
os.environ.setdefault('TORCHINDUCTOR_DISABLE', '1')
os.environ.setdefault('TORCH_COMPILE_DISABLE', '1')

import subprocess
import sys
import time
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows (avoids cp1252 UnicodeEncodeError)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def install_deps():
    """Install unsloth + trl if not present."""
    missing = []
    try:
        import unsloth  # noqa
    except ImportError:
        missing.append("unsloth[colab-new]")
    try:
        import trl  # noqa
    except ImportError:
        missing.append("trl")
    if missing:
        print(f"[SOMA Train] Installing: {', '.join(missing)}")
        subprocess.run(
            [sys.executable, "-m", "pip", "install"] + missing,
            check=True, capture_output=False
        )


def load_jsonl(path, max_samples):
    """Load SOMA's JSONL training data. Supports messages, alpaca, and sharegpt formats."""
    samples = []
    path = Path(path)

    # Support glob patterns — pick the newest file if multiple match
    if not path.exists():
        parent = path.parent
        pattern = path.name
        candidates = sorted(parent.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise FileNotFoundError(f"No training data found matching: {path}")
        path = candidates[0]
        print(f"[SOMA Train] Using newest file: {path.name}")

    alpaca_converted = 0
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)

                # Format 1: messages (native — TrainingDataExporter gemma mode, synthetic data)
                if "messages" in obj:
                    msgs = obj["messages"]
                    if len(msgs) >= 2 and any(m["role"] == "assistant" for m in msgs):
                        samples.append(msgs)

                # Format 2: alpaca (instruction/input/output or instruction/response)
                elif "instruction" in obj or "input" in obj:
                    user_text = obj.get("input") or obj.get("instruction", "")
                    asst_text = obj.get("output") or obj.get("response", "")
                    system_text = obj.get("system") or obj.get("instruction", "") if "input" in obj else ""
                    if user_text and asst_text:
                        msgs = []
                        if system_text:
                            msgs.append({"role": "system", "content": system_text})
                        msgs.append({"role": "user", "content": user_text})
                        msgs.append({"role": "assistant", "content": asst_text})
                        samples.append(msgs)
                        alpaca_converted += 1

                # Format 3: sharegpt (conversations list with from/value)
                elif "conversations" in obj:
                    convs = obj["conversations"]
                    role_map = {"human": "user", "gpt": "assistant", "system": "system"}
                    msgs = [{"role": role_map.get(c["from"], c["from"]), "content": c["value"]}
                            for c in convs if "from" in c and "value" in c]
                    if len(msgs) >= 2 and any(m["role"] == "assistant" for m in msgs):
                        samples.append(msgs)

            except (json.JSONDecodeError, KeyError):
                continue

    if alpaca_converted:
        print(f"[SOMA Train] Converted {alpaca_converted} alpaca-format samples to messages format")
    print(f"[SOMA Train] Loaded {len(samples)} valid samples from {path.name}")
    return samples[:max_samples]


def main():
    parser = argparse.ArgumentParser(description="SOMA LoRA Fine-tuning — per-lobe specialist models")
    parser.add_argument("--data", default=None, help="Path to JSONL training file")
    parser.add_argument("--output", default="./models/soma-latest", help="Output dir for weights + GGUF")
    parser.add_argument("--model", default="nvidia/nemotron-mini-4b-instruct",
                        help="Base model; defaults to SOMA's locally cached Nemotron 4B lineage")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--max-samples", type=int, default=2000)
    parser.add_argument("--max-seq-len", type=int, default=512,
                        help="Max token sequence length (512 for 4GB VRAM; 2048 for RTX 5070+)")
    parser.add_argument("--lobe", default="logos",
                        choices=["logos", "aurora", "prometheus", "thalamus"],
                        help="Which cognitive lobe to train (sets system prompt + Ollama model name)")
    parser.add_argument("--hf-token", default=os.environ.get("HF_TOKEN", ""), help="HuggingFace token")
    parser.add_argument("--ollama-model-name", default=None,
                        help="Immutable Ollama model name, for example soma-logos:v12")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--adapter-only", action="store_true",
                        help="Diagnostic mode: run gradient training and save adapter without GGUF/Ollama promotion")
    args = parser.parse_args()

    if not args.preflight_only and not args.data:
        parser.error("--data is required unless --preflight-only is used")

    # Derive Ollama model name from lobe
    ollama_model_name = args.ollama_model_name or f"soma-{args.lobe}:latest"
    lobe_system_prompt = LOBE_SYSTEM_PROMPTS[args.lobe]

    import torch
    torch._dynamo.config.disable = True
    torch._dynamo.config.suppress_errors = True

    from trl import SFTTrainer
    try:
        from trl import SFTConfig
        USE_SFT_CONFIG = True
    except ImportError:
        USE_SFT_CONFIG = False
    from transformers import TrainingArguments
    from datasets import Dataset

    if args.preflight_only:
        status = {
            "ok": bool(torch.cuda.is_available()),
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
        print(json.dumps(status))
        return 0 if status["ok"] else 2

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # HuggingFace auth
    hf_token = args.hf_token or os.environ.get("HUGGING_FACE_HUB_TOKEN", "")
    if hf_token:
        try:
            from huggingface_hub import login
            login(token=hf_token, add_to_git_credential=False)
            print("[SOMA Train] HuggingFace authenticated")
        except Exception as e:
            print(f"[SOMA Train] HF login warning: {e}")

    # ── Try unsloth (optimised path); fall back to plain peft ─────────────────
    # unsloth requires triton which needs MSVC on Windows. On machines without
    # VS Build Tools (e.g. work laptops), we fall back to transformers+peft.
    # Both paths produce a LoRA adapter. Only unsloth path exports GGUF.
    USE_UNSLOTH = False
    try:
        from unsloth import FastLanguageModel, is_bfloat16_supported
        from unsloth.chat_templates import get_chat_template
        USE_UNSLOTH = True
        print("[SOMA Train] ✅ unsloth path active (fast, GGUF export available)")
    except Exception:
        print("[SOMA Train] unsloth unavailable - using peft fallback (no GGUF on this machine)")
        print("[SOMA Train]    Install VS Build Tools 2022 to enable unsloth on Windows")

    # ── Load base model ────────────────────────────────────────────────────────
    print(f"\n[SOMA Train] Loading {args.model} ...")

    if USE_UNSLOTH:
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.model,
            max_seq_length=args.max_seq_len,
            dtype=None,
            load_in_4bit=True,
            token=hf_token or None,
        )
        model = FastLanguageModel.get_peft_model(
            model,
            r=16,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                             "gate_proj", "up_proj", "down_proj"],
            lora_alpha=16,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=42,
        )
        tokenizer = get_chat_template(tokenizer, chat_template="gemma")
    else:
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

        tokenizer = AutoTokenizer.from_pretrained(args.model, token=hf_token or None)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        model = AutoModelForCausalLM.from_pretrained(
            args.model,
            quantization_config=bnb_config,
            device_map={"": 0},
            token=hf_token or None,
        )
        model = prepare_model_for_kbit_training(model)
        model = get_peft_model(model, LoraConfig(
            r=16,
            lora_alpha=16,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        ))

    # ── Format dataset ─────────────────────────────────────────────────────────
    raw_samples = load_jsonl(args.data, args.max_samples)
    texts = []
    
    # Ensure pad token is set for chat template
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        
    # Default chat template if none is provided (e.g. for Base models)
    if tokenizer.chat_template is None:
        print("[SOMA Train] No chat template found in tokenizer. Using default Gemma/Llama-3 template.")
        tokenizer.chat_template = (
            "{% for message in messages %}"
            "{% if message['role'] == 'system' %}"
            "{{ '<|system|>\\n' + message['content'] + '<|end|>\\n' }}"
            "{% elif message['role'] == 'user' %}"
            "{{ '<|user|>\\n' + message['content'] + '<|end|>\\n' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{ '<|assistant|>\\n' + message['content'] + '<|end|>\\n' }}"
            "{% endif %}"
            "{% endfor %}"
            "{% if add_generation_prompt %}"
            "{{ '<|assistant|>\\n' }}"
            "{% endif %}"
        )
        
    for i, msgs in enumerate(raw_samples):
        try:
            # Ensure system prompt is present
            has_system = any(m.get("role") == "system" for m in msgs)
            if not has_system:
                msgs = [{"role": "system", "content": lobe_system_prompt}] + msgs
            
            # Apply chat template
            text = tokenizer.apply_chat_template(
                msgs, 
                tokenize=False, 
                add_generation_prompt=False
            )
            texts.append(text)
        except Exception as e:
            if i < 5: # Log first few errors
                print(f"[SOMA Train] Formatting error on sample {i}: {e}")
            continue

    if not texts:
        print("[SOMA Train] ERROR: No samples could be formatted. Check if the model's chat template is compatible.")
        sys.exit(1)

    print(f"[SOMA Train] Formatted {len(texts)} samples")
    dataset = Dataset.from_dict({"text": texts})

    # ── Train ──────────────────────────────────────────────────────────────────
    bf16 = torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8
    fp16 = torch.cuda.is_available() and not bf16

    print(f"\n[SOMA Train] Training {args.lobe.upper()} lobe for {args.epochs} epoch(s)...")
    print(f"[SOMA Train] Batch size: {args.batch_size} | fp16: {fp16} | bf16: {bf16}")
    print("[SOMA Train] This takes 15-90 min on GPU.\n")

    # trl >= 0.12 moved dataset_text_field/max_seq_length into SFTConfig;
    # trl >= 0.9  renamed 'tokenizer' -> 'processing_class'
    tokenizer_kwarg = 'processing_class' if USE_SFT_CONFIG else 'tokenizer'

    _sft_kwargs = dict(
        dataset_text_field="text",
        max_length=args.max_seq_len,
        dataset_num_proc=1,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        num_train_epochs=args.epochs,
        learning_rate=2e-4,
        fp16=fp16,
        bf16=bf16,
        logging_steps=25,
        optim="adamw_8bit" if USE_UNSLOTH else "paged_adamw_32bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        output_dir=str(output_dir),
        save_strategy="no",
        report_to="none",
        torch_compile=False,
        dataloader_num_workers=0,
    )

    if USE_SFT_CONFIG:
        # trl >= 0.12: all config in SFTConfig, no extra SFTTrainer args
        trainer = SFTTrainer(
            model=model,
            **{tokenizer_kwarg: tokenizer},
            train_dataset=dataset,
            args=SFTConfig(**_sft_kwargs),
        )
    else:
        # trl < 0.12: dataset_text_field etc. on SFTTrainer directly
        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=args.max_seq_len,
            dataset_num_proc=1,
            args=TrainingArguments(
                per_device_train_batch_size=args.batch_size,
                gradient_accumulation_steps=4,
                warmup_steps=10,
                num_train_epochs=args.epochs,
                learning_rate=2e-4,
                fp16=fp16,
                bf16=bf16,
                logging_steps=25,
                optim="paged_adamw_32bit",
                weight_decay=0.01,
                lr_scheduler_type="cosine",
                output_dir=str(output_dir),
                save_strategy="no",
                report_to="none",
                torch_compile=False,
                dataloader_num_workers=0,
        ),
    )

    t_start = time.time()
    train_stats = trainer.train()
    duration = time.time() - t_start

    print(f"\n[SOMA Train] Training complete — {duration/60:.1f} min, loss: {train_stats.training_loss:.4f}")

    # ── Save adapter (always) ──────────────────────────────────────────────────
    adapter_dir = output_dir / "adapter"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"[SOMA Train] LoRA adapter saved to {adapter_dir}")

    # ── GGUF export + Ollama (unsloth only) ───────────────────────────────────
    gguf_file = None
    if args.adapter_only:
        print('[SOMA Train] Adapter-only diagnostic complete; skipping GGUF export and Ollama registration')
    elif USE_UNSLOTH:
        try:
            print("\n[SOMA Train] Exporting Q4_K_M GGUF for Ollama...")
            model.save_pretrained_gguf(str(output_dir), tokenizer, quantization_method="q4_k_m")
            gguf_files = sorted(output_dir.glob("*.gguf"), key=lambda p: p.stat().st_mtime)
            if gguf_files:
                gguf_file = gguf_files[-1]
                print(f"[SOMA Train] GGUF: {gguf_file.name} ({gguf_file.stat().st_size / 1e9:.1f} GB)")
                modelfile = (
                    f"FROM {gguf_file.resolve()}\n\n"
                    f'SYSTEM {json.dumps(lobe_system_prompt)}\n\n'
                    "PARAMETER temperature 0.7\n"
                    "PARAMETER top_p 0.95\n"
                    "PARAMETER top_k 40\n"
                    "PARAMETER repeat_penalty 1.1\n"
                    "PARAMETER num_ctx 4096\n"
                    'PARAMETER stop "<end_of_turn>"\n'
                    'PARAMETER stop "<eos>"\n'
                )
                modelfile_path = output_dir / "Modelfile"
                modelfile_path.write_text(modelfile, encoding="utf-8")
                print(f"\n[SOMA Train] Registering as '{ollama_model_name}' in Ollama...")
                result = subprocess.run(["ollama", "create", ollama_model_name, "-f", str(modelfile_path)])
                if result.returncode == 0:
                    print(f"[SOMA Train] '{ollama_model_name}' registered in Ollama!")
                else:
                    print(f"[SOMA Train] ollama create failed — manual fix:")
                    print(f"[SOMA Train]   ollama create {ollama_model_name} -f {modelfile_path}")
        except Exception as e:
            print(f"[SOMA Train] GGUF export failed: {e}")
            print("[SOMA Train] Adapter saved — re-run on RTX 5070 for full GGUF export")
    else:
        print("[SOMA Train] Exporting PEFT adapter through llama.cpp...")
        exporter = Path(os.getcwd()) / 'scripts' / 'export_adapter_to_ollama.py'
        export_result = subprocess.run([
            sys.executable,
            str(exporter),
            '--adapter-dir', str(adapter_dir),
            '--base-model', args.model,
            '--output-dir', str(output_dir),
            '--model-name', ollama_model_name,
            '--lobe', args.lobe,
        ])
        if export_result.returncode != 0:
            print('[SOMA Train] Adapter export or Ollama registration failed')
            return 2
        exported = sorted(output_dir.glob('*.gguf'), key=lambda p: p.stat().st_mtime)
        gguf_file = exported[-1] if exported else None
        if gguf_file is None:
            print('[SOMA Train] Export completed without a GGUF artifact')
            return 2

    # Save training log
    log = {
        "timestamp": time.time(),
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "lobe": args.lobe,
        "ollama_model": ollama_model_name,
        "samples": len(texts),
        "epochs": args.epochs,
        "training_loss": round(train_stats.training_loss, 4),
        "duration_minutes": round(duration / 60, 1),
        "base_model": args.model,
        "adapter_path": str(adapter_dir),
        "gguf_path": str(gguf_file) if gguf_file else None,
        "gguf_size_gb": round(gguf_file.stat().st_size / 1e9, 2) if gguf_file else None,
        "ollama_registered": gguf_file is not None,
    }

    log_path = output_dir / "training_log.json"
    log_path.write_text(json.dumps(log, indent=2))

    history_path = Path(os.getcwd()) / "SOMA" / "training-history.json"
    try:
        history = json.loads(history_path.read_text()) if history_path.exists() else []
        history.append(log)
        history_path.write_text(json.dumps(history, indent=2))
    except Exception:
        pass

    print(f"\n[SOMA Train] -------------------------------------------------")
    print(f"[SOMA Train]  {args.lobe.upper()} lobe training complete")
    print(f"[SOMA Train]  Loss: {train_stats.training_loss:.4f} | Samples: {len(texts)} | Time: {duration/60:.1f}min")
    print(f"[SOMA Train]  Adapter: {adapter_dir}")
    if gguf_file:
        print(f"[SOMA Train]  Ollama: {ollama_model_name} ({gguf_file.name})")
    print(f"[SOMA Train] -------------------------------------------------")
    return 0


if __name__ == "__main__":
    sys.exit(main())
