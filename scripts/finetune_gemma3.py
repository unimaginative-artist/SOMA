"""
SOMA Lobe Fine-Tuning Script
Domain-starvation training: each lobe gets its own LoRA adapter.
Optimized for NVIDIA GTX 1650 Ti (4GB VRAM) via QLoRA.

Usage:
  python finetune_gemma3.py --lobe logos
  python finetune_gemma3.py --lobe aurora --epochs 5
  python finetune_gemma3.py --lobe thalamus --model TinyLlama/TinyLlama-1.1B-Chat-v1.0
  python finetune_gemma3.py --all         # train all 4 lobes sequentially
"""

import os
import sys
import json
import math
import argparse
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path

# Force UTF-8 stdout/stderr so the many emoji log lines don't crash under a
# non-TTY subprocess (Windows defaults to cp1252 there) — the federated bridge
# spawns this script, so this path matters.
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# Heavy ML stack is imported fault-tolerantly so --dry-run / --help / argparse
# work even when torch/transformers/peft aren't installed or are broken. The real
# training paths check _ML_IMPORT_ERROR and fail LOUDLY with the reason (rather
# than the old bridge's silent fake metrics).
_ML_IMPORT_ERROR = None
try:
    import torch
    import transformers
    from transformers import (
        AutoTokenizer,
        AutoModelForCausalLM,
        TrainingArguments,
        Trainer,
        BitsAndBytesConfig,
    )
    from peft import (
        LoraConfig,
        get_peft_model,
        prepare_model_for_kbit_training,
    )
    from datasets import load_dataset
except Exception as _ml_import_err:  # noqa: BLE001
    torch = None
    _ML_IMPORT_ERROR = _ml_import_err

LOBES = ['logos', 'aurora', 'prometheus', 'thalamus']


# ── Federated-bridge glue: machine-readable results for FederatedLearning.cjs ──
def _emit_result(json_path, result):
    """Emit a machine-readable training result the Node.js federated bridge can
    parse. Writes to --json-result if given, and ALWAYS prints a delimited line
    to stdout as a fallback channel."""
    try:
        if json_path:
            p = Path(json_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(result), encoding='utf-8')
    except Exception as e:
        print(f'⚠️  Could not write --json-result: {e}')
    try:
        print('__SOMA_TRAIN_RESULT__' + json.dumps(result))
    except Exception:
        pass


def _extract_metrics(trainer, train_output=None):
    """Pull REAL metrics off a finished HF/TRL trainer — no fabricated numbers.
    Returns train_loss (final), eval_loss (best/last), perplexity=exp(eval_loss),
    and step count. Any field that genuinely isn't available comes back as None
    rather than a made-up value."""
    metrics = {}
    try:
        if train_output is not None and getattr(train_output, 'metrics', None):
            metrics.update(train_output.metrics)
    except Exception:
        pass
    train_loss = metrics.get('train_loss')
    eval_loss = None
    try:
        for entry in reversed(trainer.state.log_history or []):
            if 'eval_loss' in entry:
                eval_loss = entry['eval_loss']
                break
    except Exception:
        pass
    perplexity = None
    try:
        if eval_loss is not None:
            perplexity = float(math.exp(eval_loss))
    except Exception:
        perplexity = None
    steps = None
    try:
        steps = int(trainer.state.global_step)
    except Exception:
        pass
    return {
        'train_loss': train_loss,
        'eval_loss': eval_loss,
        'perplexity': perplexity,
        'steps': steps,
    }

@dataclass
class ModelArguments:
    model_name: str = field(default="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    model_path: Optional[str] = field(default=None)
    use_4bit: bool = field(default=True)
    use_nested_quant: bool = field(default=True)

@dataclass
class DataArguments:
    data_path: str = field(default="./SOMA/training-data")
    lobe: str = field(default="logos")
    max_length: int = field(default=512)

@dataclass
class LoraArguments:
    lora_r: int = field(default=8)
    lora_alpha: int = field(default=16)
    lora_dropout: float = field(default=0.05)
    lora_target_modules: str = field(default="q_proj,v_proj")

def load_model_and_tokenizer(model_args):
    """Load Gemma with 4-bit quantization"""
    
    print(f"Loading {model_args.model_name} with 4-bit quantization...")
    
    # Configure 4-bit quantization for GTX 1650 Ti
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=model_args.use_4bit,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=model_args.use_nested_quant
    )
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        model_args.model_name,
        trust_remote_code=True
    )
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    
    # Load model with quantization
    model = AutoModelForCausalLM.from_pretrained(
        model_args.model_name,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True
    )
    
    # Prepare for LoRA training
    model = prepare_model_for_kbit_training(model)
    
    print(f"✅ Model loaded on {model.device}")
    print(f"✅ Memory footprint: {model.get_memory_footprint() / 1024**3:.2f} GB")
    
    return model, tokenizer

def setup_lora(model, lora_args):
    """Configure LoRA for efficient fine-tuning"""
    
    print("Setting up LoRA...")
    
    target_modules = lora_args.lora_target_modules.split(",")
    
    lora_config = LoraConfig(
        r=lora_args.lora_r,
        lora_alpha=lora_args.lora_alpha,
        target_modules=target_modules,
        lora_dropout=lora_args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM"
    )
    
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    return model

def prepare_dataset(data_path, tokenizer, max_length, lobe=None):
    """Load and tokenize SOMA training data — lobe-specific if lobe is set."""

    data_dir = Path(data_path)

    if lobe:
        # Load from FINAL/ directory — domain-isolated dataset for this lobe
        final_dir = data_dir / 'FINAL'
        training_files = sorted(final_dir.glob(f"lobe-{lobe}-final-*.jsonl")) if final_dir.exists() else []
        if not training_files:
            # Fall back to any lobe-specific file
            training_files = sorted(data_dir.glob(f"lobe-{lobe}-*.jsonl"))
        if not training_files:
            raise FileNotFoundError(
                f"No training data found for lobe '{lobe}'.\n"
                f"Run: node scripts/build-lobe-datasets.mjs --lobe {lobe}"
            )
        print(f"[{lobe.upper()}] Loading {len(training_files)} dataset file(s)...")
        import tempfile
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8')
        total_examples = 0
        for f in training_files:
            file_count = 0
            with open(f, 'r', encoding='utf-8') as infile:
                import json
                for line in infile:
                    line_str = line.strip()
                    if line_str:
                        try:
                            item = json.loads(line_str)
                            if 'metadata' in item:
                                del item['metadata']
                            tmp.write(json.dumps(item) + '\n')
                            file_count += 1
                        except Exception:
                            pass
            total_examples += file_count
            print(f"  {f.name}: {file_count} examples")
        tmp.close()
        latest_file = Path(tmp.name)
        print(f"[{lobe.upper()}] Total: {total_examples} examples")
    else:
        print(f"Loading dataset from {data_path}...")
        training_files = sorted(data_dir.glob("soma-training-burst-*.jsonl"))
        if not training_files:
            training_files = sorted(data_dir.glob("soma-training-*.jsonl"))
        if not training_files:
            raise FileNotFoundError(f"No training data found in {data_path}")
        latest_file = training_files[-1]

    print(f"Using: {latest_file}")
    
    # Load dataset
    dataset = load_dataset("json", data_files=str(latest_file), split="train")
    
    def tokenize_function(examples):
        # Convert messages format to text
        texts = []
        for msg_list in examples["messages"]:
            # Build conversation
            conversation = ""
            for msg in msg_list:
                if msg["role"] == "system":
                    conversation += f"System: {msg['content']}\n\n"
                elif msg["role"] == "user":
                    conversation += f"User: {msg['content']}\n\n"
                elif msg["role"] == "assistant":
                    conversation += f"Assistant: {msg['content']}\n\n"
            texts.append(conversation.strip())
        
        # Tokenize
        tokenized = tokenizer(
            texts,
            truncation=True,
            max_length=max_length,
            padding="max_length",
            return_tensors="pt"
        )
        
        # Labels = input_ids (causal LM)
        tokenized["labels"] = tokenized["input_ids"].clone()
        
        return tokenized
    
    # Tokenize dataset
    tokenized_dataset = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=dataset.column_names,
        desc="Tokenizing"
    )
    
    # Split train/val
    split = tokenized_dataset.train_test_split(test_size=0.05)
    
    print(f"✅ Train examples: {len(split['train'])}")
    print(f"✅ Val examples: {len(split['test'])}")
    
    return split['train'], split['test']

def train(
    model,
    tokenizer,
    train_dataset,
    eval_dataset,
    output_dir="./SOMA/models/gemma3-soma-lora",
    lobe=None,
    epochs=3,
    max_steps=0
):
    """Train with GTX 1650 Ti-optimized settings"""

    lobe_label = f" [{lobe.upper()} lobe]" if lobe else ""
    print(f"Starting training{lobe_label}...")
    if max_steps and max_steps > 0:
        print(f"  (max_steps={max_steps} — capped run, e.g. smoke test)")

    actual_max_steps = max_steps if max_steps and max_steps > 0 else -1
    step_freq = min(100, actual_max_steps) if actual_max_steps > 0 else 100

    # Training arguments optimized for 4GB VRAM
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        max_steps=actual_max_steps,
        per_device_train_batch_size=1,  # Small batch for limited VRAM
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=16,  # Effective batch = 16
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        warmup_steps=min(28, max(1, actual_max_steps // 2)) if actual_max_steps > 0 else 28,
        logging_steps=min(10, max(1, actual_max_steps)),
        save_strategy="steps",
        save_steps=step_freq,
        eval_strategy="steps",
        eval_steps=step_freq,
        save_total_limit=3,
        load_best_model_at_end=(actual_max_steps < 0),
        fp16=True,  # Mixed precision for speed
        gradient_checkpointing=True,  # Save memory
        optim="paged_adamw_8bit",  # Memory-efficient optimizer
        report_to="tensorboard",
        remove_unused_columns=False,
        max_grad_norm=0.3,
        weight_decay=0.001
    )
    
    # Initialize trainer (transformers 5.x: tokenizer -> processing_class)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer
    )
    
    # Train
    print("\n🚀 Training started...")
    train_output = trainer.train()

    # Save final model
    print("\n💾 Saving model...")
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)

    print(f"\n✅ Training complete! Model saved to {output_dir}")
    return _extract_metrics(trainer, train_output)


def train_lobe(lobe, model_name, data_path, lora_args, max_length=512, epochs=3, max_steps=0):
    """Full pipeline for one lobe: load → LoRA → train → save."""
    root = Path(__file__).parent.parent
    output_dir = str(root / 'SOMA' / 'models' / f'lobe-{lobe}')

    print(f"\n{'='*60}")
    print(f"  LOBE: {lobe.upper()}")
    print(f"  Model: {model_name}")
    print(f"  Output: {output_dir}")
    print(f"{'='*60}\n")

    model_args = ModelArguments(model_name=model_name)
    model, tokenizer = load_model_and_tokenizer(model_args)
    model = setup_lora(model, lora_args)

    train_dataset, eval_dataset = prepare_dataset(
        data_path, tokenizer, max_length, lobe=lobe
    )

    metrics = train(model, tokenizer, train_dataset, eval_dataset,
          output_dir=output_dir, lobe=lobe, epochs=epochs, max_steps=max_steps)

    # Attempt GGUF export for Ollama import
    gguf_path = Path(output_dir) / f'soma-{lobe}.gguf'
    print(f"\nAttempting GGUF export to {gguf_path}...")
    try:
        import subprocess
        result = subprocess.run(
            ['python', '-m', 'llama_cpp.convert', '--outfile', str(gguf_path), output_dir],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            print(f"✅ GGUF export success: {gguf_path}")
            _write_modelfile(lobe, gguf_path, root)
        else:
            print(f"⚠️  GGUF export failed (llama-cpp-python may not be installed).")
            print(f"   To install: pip install llama-cpp-python")
            print(f"   Then: python -m llama_cpp.convert --outfile {gguf_path} {output_dir}")
    except Exception as e:
        print(f"⚠️  GGUF export skipped: {e}")

    print(f"\n✅ Lobe {lobe.upper()} done.")
    return {
        'ok': True,
        'lobe': lobe,
        'mode': 'sft',
        'model': model_name,
        'output_dir': output_dir,
        'weights_path': output_dir,
        'examples': len(train_dataset),
        'epochs': epochs,
        **metrics,
    }


def _write_modelfile(lobe, gguf_path, root):
    """Write an Ollama MODELFILE so you can do: ollama create soma-{lobe}"""
    system_prompts = {
        'logos':      "You are SOMA's LOGOS lobe — cold, precise, expert in engineering, code, and architecture.",
        'aurora':     "You are SOMA's AURORA lobe — warm, creative, attuned to voice, emotion, and presence.",
        'prometheus': "You are SOMA's PROMETHEUS lobe — strategic, consequence-focused, thinking in systems.",
        'thalamus':   "You are SOMA's THALAMUS lobe — vigilant, threat-aware, expert in risk and anomaly detection.",
    }
    models_dir = root / 'SOMA' / 'models'
    modelfile = models_dir / f'Modelfile.{lobe}'
    modelfile.write_text(
        f'FROM {gguf_path}\nSYSTEM """{system_prompts[lobe]}"""\n',
        encoding='utf-8'
    )
    print(f"✅ Modelfile written: {modelfile}")
    print(f"   Register with Ollama: ollama create soma-{lobe} -f {modelfile}")


def load_dpo_dataset(dpo_dir, lobe=None):
    """Load NEMESIS revision pairs for DPO training.
    Format on disk: {prompt, chosen, rejected, critique, score, ts}
    DPOTrainer expects: {prompt, chosen, rejected}
    """
    import glob as glob_module
    dpo_path = Path(dpo_dir)
    if not dpo_path.exists():
        raise FileNotFoundError(
            f"No DPO data found at {dpo_dir}\n"
            f"DPO pairs accumulate automatically as NEMESIS catches and revises bad responses."
        )

    all_pairs = []
    for fpath in sorted(dpo_path.glob('revision-pairs-*.jsonl')):
        for line in fpath.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                pair = json.loads(line)
                if pair.get('prompt') and pair.get('chosen') and pair.get('rejected'):
                    # Only include genuine revisions (score below threshold means bad)
                    score = pair.get('score', 0)
                    if isinstance(score, (int, float)) and score > 0.6:
                        continue  # high score = already good, revision was marginal
                    all_pairs.append({
                        'prompt':   pair['prompt'][:800],
                        'chosen':   pair['chosen'][:2000],
                        'rejected': pair['rejected'][:2000],
                    })
            except Exception:
                continue

    if not all_pairs:
        raise ValueError(
            f"Found DPO files but no valid pairs in {dpo_dir}\n"
            f"Pairs accumulate as SOMA runs — check back after more conversations."
        )

    print(f"[DPO] Loaded {len(all_pairs)} revision pairs from {dpo_dir}")

    from datasets import Dataset
    ds = Dataset.from_list(all_pairs)
    split = ds.train_test_split(test_size=min(0.1, max(1, len(all_pairs) // 10) / len(all_pairs)))
    print(f"[DPO] Train: {len(split['train'])}  Eval: {len(split['test'])}")
    return split['train'], split['test']


def train_dpo(lobe, model_name, dpo_dir, lora_args, epochs=1, max_steps=0):
    """DPO fine-tuning on NEMESIS revision pairs.
    Run this AFTER SFT training — it refines the already-trained lobe.
    Uses the saved lobe checkpoint as the reference model.
    """
    try:
        from trl import DPOTrainer, DPOConfig
    except ImportError:
        print("❌ trl not installed. Run: pip install trl")
        sys.exit(1)

    root = Path(__file__).parent.parent
    sft_dir = str(root / 'SOMA' / 'models' / f'lobe-{lobe}')
    output_dir = str(root / 'SOMA' / 'models' / f'lobe-{lobe}-dpo')

    print(f"\n{'='*60}")
    print(f"  DPO TRAINING: {lobe.upper()} lobe")
    print(f"  Base model: {sft_dir} (SFT checkpoint)")
    print(f"  Output: {output_dir}")
    print(f"{'='*60}\n")

    # Load the SFT-trained lobe as base (fall back to pretrained model if not trained yet)
    base = sft_dir if Path(sft_dir).exists() else model_name
    if not Path(sft_dir).exists():
        print(f"⚠️  SFT checkpoint not found at {sft_dir} — using base model {model_name}")
        print(f"   Recommend running SFT first: python finetune_gemma3.py --lobe {lobe}")

    model_args = ModelArguments(model_name=base)
    model, tokenizer = load_model_and_tokenizer(model_args)
    model = setup_lora(model, lora_args)

    train_dataset, eval_dataset = load_dpo_dataset(dpo_dir, lobe)

    dpo_config = DPOConfig(
        output_dir=output_dir,
        num_train_epochs=epochs,
        max_steps=(max_steps if max_steps and max_steps > 0 else -1),  # >0 overrides epochs (smoke tests)
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=5e-5,
        beta=0.1,
        bf16=True,  # bf16 (not fp16) — 4-bit compute dtype is bf16, and fp16's
                    # GradScaler.unscale has no BFloat16 CUDA kernel. bf16 needs
                    # no scaler and is native on Blackwell (RTX 5070).
        gradient_checkpointing=True,
        optim="paged_adamw_8bit",
        logging_steps=5,
        save_strategy="epoch",
        eval_strategy="epoch",
        report_to="tensorboard",
        max_length=512,
        # max_prompt_length removed — dropped from DPOConfig in trl 1.9.x.
    )

    trainer = DPOTrainer(
        model=model,
        ref_model=None,  # uses LoRA implicit reference
        args=dpo_config,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
    )

    print("\n🚀 DPO training started...")
    dpo_output = trainer.train()
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)

    _write_modelfile(lobe, Path(output_dir) / f'soma-{lobe}-dpo.gguf', root)
    print(f"\n✅ DPO training complete! Model saved to {output_dir}")
    print(f"   Register: ollama create soma-{lobe} -f SOMA/models/Modelfile.{lobe}")
    return {
        'ok': True,
        'lobe': lobe,
        'mode': 'dpo',
        'model': model_name,
        'output_dir': output_dir,
        'weights_path': output_dir,
        'examples': len(train_dataset),
        'epochs': epochs,
        **_extract_metrics(trainer, dpo_output),
    }


def main():
    parser = argparse.ArgumentParser(description='SOMA Lobe Fine-Tuning')
    parser.add_argument('--lobe', choices=LOBES, help='Train a specific lobe')
    parser.add_argument('--all', action='store_true', help='Train all 4 lobes sequentially')
    parser.add_argument('--model', default='TinyLlama/TinyLlama-1.1B-Chat-v1.0',
                        help='HuggingFace model ID or local path')
    parser.add_argument('--epochs', type=int, default=3)
    parser.add_argument('--max-length', type=int, default=512)
    parser.add_argument('--data-path', default='./SOMA/training-data')
    parser.add_argument('--dpo', action='store_true',
                        help='DPO fine-tuning mode — trains on NEMESIS revision pairs instead of SFT. '
                             'Run after SFT to refine the lobe using SOMA\'s own mistake corrections.')
    parser.add_argument('--dpo-data', default='./SOMA/training-data/dpo',
                        help='Path to DPO revision pairs directory (default: ./SOMA/training-data/dpo)')
    # ── Federated-bridge flags (used by cluster/FederatedLearning.cjs) ──
    parser.add_argument('--yes', '-y', action='store_true',
                        help='Non-interactive: never prompt. Required when launched by the federated bridge.')
    parser.add_argument('--json-result', default=None,
                        help='Write a machine-readable training result JSON to this path (for the bridge).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Verify bridge plumbing only: emit a result JSON and exit WITHOUT training.')
    parser.add_argument('--max-steps', type=int, default=0,
                        help='Cap total optimizer steps (0 = full epochs). Small value = fast smoke test.')
    args = parser.parse_args()

    if not args.lobe and not args.all:
        parser.print_help()
        print('\nExamples:')
        print('  python finetune_gemma3.py --lobe logos                    # SFT training')
        print('  python finetune_gemma3.py --lobe logos --dpo              # DPO refinement')
        print('  python finetune_gemma3.py --all                           # all 4 lobes SFT')
        sys.exit(1)

    lobes_to_train = LOBES if args.all else [args.lobe]

    # Dry-run: verify the bridge plumbing (argparse → result JSON → parse) without
    # loading a model or touching the GPU. Must run BEFORE the CUDA check.
    if args.dry_run:
        root = Path(__file__).parent.parent
        dry_results = []
        for lobe in lobes_to_train:
            out = str(root / 'SOMA' / 'models' / (f'lobe-{lobe}-dpo' if args.dpo else f'lobe-{lobe}'))
            dry_results.append({
                'ok': True, 'dry_run': True, 'lobe': lobe,
                'mode': 'dpo' if args.dpo else 'sft', 'model': args.model,
                'output_dir': out, 'weights_path': out,
                'examples': 0, 'epochs': args.epochs,
                'train_loss': None, 'eval_loss': None, 'perplexity': None,
                'note': 'dry-run: bridge plumbing verified, no training performed',
            })
        _emit_result(args.json_result, dry_results[0] if len(dry_results) == 1 else {'ok': True, 'dry_run': True, 'results': dry_results})
        print('✅ Dry-run complete (bridge plumbing only, no training performed).')
        return

    # Real training needs the ML stack. Fail loudly (not silently) if it's broken.
    if _ML_IMPORT_ERROR is not None:
        print(f'❌ ML stack unavailable: {type(_ML_IMPORT_ERROR).__name__}: {_ML_IMPORT_ERROR}')
        print('   Fix the training venv (torch/transformers/peft/trl), then retry.')
        _emit_result(args.json_result, {
            'ok': False, 'error': 'ml_stack_unavailable',
            'message': f'{type(_ML_IMPORT_ERROR).__name__}: {_ML_IMPORT_ERROR}',
        })
        sys.exit(3)

    # Check CUDA
    print('=' * 60)
    mode = 'DPO Refinement' if args.dpo else 'SFT Domain Starvation'
    print(f'SOMA Lobe Fine-Tuning ({mode})')
    print('=' * 60)
    if not torch.cuda.is_available():
        print('WARNING: CUDA not available -- training will be very slow on CPU.')
        if args.yes:
            print('  --yes given: proceeding on CPU.')
        elif not sys.stdin.isatty():
            # Never silently CPU-train (hours) or hang on stdin when driven by the bridge.
            print('  Non-interactive and CUDA unavailable: refusing to CPU-train. Pass --yes to force.')
            _emit_result(args.json_result, {
                'ok': False, 'error': 'cuda_unavailable',
                'message': 'CUDA not available; pass --yes to force CPU training',
            })
            sys.exit(2)
        elif input('Continue anyway? (y/n): ').lower() != 'y':
            sys.exit(0)
    else:
        print(f'CUDA: {torch.cuda.get_device_name(0)}')
        print(f'VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB')

    lora_args = LoraArguments()

    results = []
    for lobe in lobes_to_train:
        if args.dpo:
            results.append(train_dpo(
                lobe=lobe,
                model_name=args.model,
                dpo_dir=args.dpo_data,
                lora_args=lora_args,
                epochs=args.epochs,
                max_steps=args.max_steps,
            ))
        else:
            results.append(train_lobe(
                lobe=lobe,
                model_name=args.model,
                data_path=args.data_path,
                lora_args=lora_args,
                max_length=args.max_length,
                epochs=args.epochs,
                max_steps=args.max_steps,
            ))

    # Emit the real, machine-readable result for the federated bridge.
    _emit_result(args.json_result, results[0] if len(results) == 1 else {'ok': True, 'results': results})

    print(f"\n🎉 All done! {len(lobes_to_train)} lobe(s) trained.")
    if lobes_to_train:
        print("\nTo use a lobe in Ollama:")
        for lobe in lobes_to_train:
            print(f"  ollama create soma-{lobe} -f SOMA/models/Modelfile.{lobe}")

if __name__ == "__main__":
    main()
