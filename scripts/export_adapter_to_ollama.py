#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path

from export_lobe_gguf import convert_to_gguf, merge_lora


SYSTEM_PROMPTS = {
    'logos': "You are SOMA's LOGOS lobe: precise, evidence-driven, and expert in engineering and architecture.",
    'aurora': "You are SOMA's AURORA lobe: creative, warm, coherent, and attentive to voice and emotion.",
    'prometheus': "You are SOMA's PROMETHEUS lobe: strategic, measured, and focused on downstream consequences.",
    'thalamus': "You are SOMA's THALAMUS lobe: skeptical, safety-focused, and expert in risk and anomaly detection.",
}


def main():
    parser = argparse.ArgumentParser(description='Merge a SOMA LoRA adapter, convert it to GGUF, and register it in Ollama')
    parser.add_argument('--adapter-dir', required=True)
    parser.add_argument('--base-model', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--model-name', required=True)
    parser.add_argument('--lobe', required=True, choices=sorted(SYSTEM_PROMPTS))
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    output_dir = Path(args.output_dir).resolve()
    adapter_dir = Path(args.adapter_dir).resolve()
    merged_dir = output_dir / 'merged'
    gguf_path = output_dir / f'{args.model_name.replace(":", "-")}.f16.gguf'
    llama_cpp_dir = root / 'llama.cpp'

    if not adapter_dir.exists():
        raise FileNotFoundError(f'Adapter directory does not exist: {adapter_dir}')
    if not (llama_cpp_dir / 'convert_hf_to_gguf.py').exists():
        raise FileNotFoundError('llama.cpp/convert_hf_to_gguf.py is required for Ollama promotion')

    merge_lora(adapter_dir, args.base_model, merged_dir)
    convert_to_gguf(merged_dir, gguf_path, llama_cpp_dir)

    modelfile = output_dir / 'Modelfile'
    modelfile.write_text(
        f'FROM {gguf_path}\nSYSTEM {json.dumps(SYSTEM_PROMPTS[args.lobe])}\n'
        'PARAMETER temperature 0.7\nPARAMETER top_p 0.95\nPARAMETER num_ctx 4096\n',
        encoding='utf-8'
    )
    result = subprocess.run(['ollama', 'create', args.model_name, '--quantize', 'q4_K_M', '-f', str(modelfile)])
    if result.returncode != 0:
        raise RuntimeError(f'ollama create failed with exit code {result.returncode}')

    print(json.dumps({
        'ok': True,
        'model': args.model_name,
        'adapter': str(adapter_dir),
        'merged': str(merged_dir),
        'gguf': str(gguf_path),
        'modelfile': str(modelfile),
    }))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr)
        raise SystemExit(2)
