"""
Merge SOMA lobe LoRA adapter into base model and export to GGUF for Ollama.

Usage:
  python scripts/export_lobe_gguf.py --lobe thalamus
  python scripts/export_lobe_gguf.py --lobe thalamus --base nvidia/nemotron-mini-4b-instruct
  python scripts/export_lobe_gguf.py --all
"""

import argparse
import subprocess
import sys
import os
from pathlib import Path

LOBES = ['logos', 'aurora', 'prometheus', 'thalamus']

SYSTEM_PROMPTS = {
    'logos':      "You are SOMA's LOGOS lobe — cold, precise, expert in engineering, code, and architecture.",
    'aurora':     "You are SOMA's AURORA lobe — warm, creative, attuned to voice, emotion, and presence.",
    'prometheus': "You are SOMA's PROMETHEUS lobe — strategic, consequence-focused, thinking in systems.",
    'thalamus':   "You are SOMA's THALAMUS lobe — vigilant, threat-aware, expert in risk and anomaly detection.",
}

DEFAULT_BASE = {
    'logos':      'nvidia/nemotron-mini-4b-instruct',
    'aurora':     'nvidia/nemotron-mini-4b-instruct',
    'prometheus': 'nvidia/nemotron-mini-4b-instruct',
    'thalamus':   'nvidia/nemotron-mini-4b-instruct',
}


def merge_lora(lobe_dir: Path, base_model: str, merged_dir: Path):
    """Merge LoRA adapter weights into base model and save as full HF model."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print(f"  Loading base model: {base_model}")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16,
        device_map='cpu',
        trust_remote_code=True,
    )

    print(f"  Loading LoRA adapter from: {lobe_dir}")
    model = PeftModel.from_pretrained(model, str(lobe_dir))

    print("  Merging adapter weights...")
    model = model.merge_and_unload()

    print(f"  Saving merged model to: {merged_dir}")
    merged_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(merged_dir))
    tokenizer.save_pretrained(str(merged_dir))

    # llama.cpp's nemotron converter needs tokenizer.model (SentencePiece file).
    # HuggingFace save_pretrained only writes tokenizer.json; copy the .model from cache.
    tm_dest = merged_dir / 'tokenizer.model'
    if not tm_dest.exists():
        import shutil
        tm_src = getattr(tokenizer, 'vocab_file', None)
        if tm_src and Path(tm_src).exists():
            shutil.copy2(tm_src, tm_dest)
            print(f"  Copied tokenizer.model from: {tm_src}")
        else:
            lineage_candidates = list((Path.cwd() / 'SOMA' / 'models').glob('lobe-*-merged/tokenizer.model'))
            if lineage_candidates:
                shutil.copy2(lineage_candidates[0], tm_dest)
                print(f"  Reused tokenizer.model from verified model lineage: {lineage_candidates[0]}")
            else:
                raise FileNotFoundError('tokenizer.model is required for Nemotron GGUF conversion')

    print("  Merge complete.")
    return merged_dir


def get_llama_cpp_convert_script(root: Path) -> Path:
    """Return path to llama.cpp convert script, cloning if needed."""
    llama_cpp_dir = root / 'llama.cpp'
    convert_script = llama_cpp_dir / 'convert_hf_to_gguf.py'

    if convert_script.exists():
        return convert_script

    print("  llama.cpp not found — cloning (shallow)...")
    result = subprocess.run(
        ['git', 'clone', '--depth=1', 'https://github.com/ggerganov/llama.cpp', str(llama_cpp_dir)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"git clone failed:\n{result.stderr}")
    print("  llama.cpp cloned.")
    return convert_script


def convert_to_gguf(merged_dir: Path, gguf_path: Path, llama_cpp_dir: Path) -> Path:
    """Convert merged HF model to GGUF using llama.cpp convert script."""
    convert_script = llama_cpp_dir / 'convert_hf_to_gguf.py'

    # Install llama.cpp Python deps if needed
    req_file = llama_cpp_dir / 'requirements' / 'requirements-convert_hf_to_gguf.txt'
    if not req_file.exists():
        req_file = llama_cpp_dir / 'requirements.txt'
    if req_file.exists():
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(req_file), '-q'], check=False)

    print(f"  Converting to GGUF: {gguf_path}")
    result = subprocess.run(
        [sys.executable, str(convert_script),
         str(merged_dir),
         '--outfile', str(gguf_path),
         '--outtype', 'f16'],
        capture_output=True, text=True, timeout=600
    )
    if result.returncode != 0:
        raise RuntimeError(f"GGUF conversion failed:\n{result.stderr}\n{result.stdout}")
    print(f"  GGUF written: {gguf_path}")
    return gguf_path


def write_modelfile(lobe: str, gguf_path: Path, models_dir: Path) -> Path:
    modelfile = models_dir / f'Modelfile.{lobe}'
    modelfile.write_text(
        f'FROM {gguf_path}\nSYSTEM """{SYSTEM_PROMPTS[lobe]}"""\n',
        encoding='utf-8'
    )
    print(f"  Modelfile: {modelfile}")
    return modelfile


def export_lobe(lobe: str, base_model: str, root: Path, skip_merge: bool = False):
    models_dir = root / 'SOMA' / 'models'
    lobe_dir   = models_dir / f'lobe-{lobe}'
    merged_dir = models_dir / f'lobe-{lobe}-merged'
    gguf_path  = models_dir / f'soma-{lobe}.gguf'
    llama_cpp_dir = root / 'llama.cpp'

    if not lobe_dir.exists():
        raise FileNotFoundError(f"No trained adapter at {lobe_dir} — run finetune_gemma3.py first.")

    print(f"\n{'='*56}")
    print(f"  Exporting LOBE: {lobe.upper()}")
    print(f"{'='*56}")

    if not skip_merge:
        merge_lora(lobe_dir, base_model, merged_dir)
    else:
        print(f"  Skipping merge (--skip-merge), using: {merged_dir}")

    if not llama_cpp_dir.exists():
        get_llama_cpp_convert_script(root)

    convert_to_gguf(merged_dir, gguf_path, llama_cpp_dir)
    modelfile = write_modelfile(lobe, gguf_path, models_dir)

    print(f"\nDone. Register with Ollama:")
    print(f"  ollama create soma-{lobe} -f {modelfile}")


def main():
    parser = argparse.ArgumentParser(description='Export SOMA lobe LoRA → GGUF for Ollama')
    parser.add_argument('--lobe', choices=LOBES, help='Export a specific lobe')
    parser.add_argument('--all', action='store_true', help='Export all trained lobes')
    parser.add_argument('--base', default=None, help='Override base model HF ID')
    parser.add_argument('--skip-merge', action='store_true',
                        help='Skip merge step (use existing merged dir)')
    args = parser.parse_args()

    if not args.lobe and not args.all:
        parser.print_help()
        sys.exit(1)

    root = Path(__file__).parent.parent
    lobes = LOBES if args.all else [args.lobe]

    for lobe in lobes:
        base = args.base or DEFAULT_BASE[lobe]
        export_lobe(lobe, base, root, skip_merge=args.skip_merge)

    print(f"\nAll done. Start using in Ollama:")
    for lobe in lobes:
        print(f"  ollama create soma-{lobe} -f SOMA/models/Modelfile.{lobe}")


if __name__ == '__main__':
    main()
