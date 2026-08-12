#!/usr/bin/env python3
import argparse
import importlib.metadata
import json
import sys


def package_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-free-gb', type=float, default=6.0)
    args = parser.parse_args()
    result = {
        'ok': False,
        'python': sys.version.split()[0],
        'packages': {},
        'cuda': False,
        'gpu': None,
        'freeGpuGb': 0,
        'errors': [],
    }

    # Python 3.13 is now approved: verified working end-to-end with
    # torch 2.13.0+cu130 + bitsandbytes 4-bit on RTX 5070 (2026-08-11). The real
    # gate is the package + GPU checks below, not the interpreter version.
    if sys.version_info < (3, 10):
        result['errors'].append(f'Python {sys.version_info.major}.{sys.version_info.minor} too old; need >= 3.10')

    for name in ['torch', 'torchvision', 'transformers', 'trl', 'peft', 'datasets', 'bitsandbytes']:
        result['packages'][name] = package_version(name)
        if not result['packages'][name]:
            result['errors'].append(f'missing package: {name}')

    try:
        import torch
        import torchvision  # noqa: F401
        from trl import SFTConfig, SFTTrainer  # noqa: F401
        from transformers import AutoModelForCausalLM, AutoProcessor  # noqa: F401
        import peft  # noqa: F401
        import datasets  # noqa: F401
        import bitsandbytes  # noqa: F401

        result['cuda'] = bool(torch.cuda.is_available())
        if result['cuda']:
            result['gpu'] = torch.cuda.get_device_name(0)
            free_bytes, _ = torch.cuda.mem_get_info(0)
            result['freeGpuGb'] = round(free_bytes / (1024 ** 3), 2)
            if result['freeGpuGb'] < args.require_free_gb:
                result['errors'].append(
                    f'only {result["freeGpuGb"]} GiB GPU memory free; require {args.require_free_gb} GiB'
                )
        else:
            result['errors'].append('CUDA is unavailable')
    except Exception as exc:
        result['errors'].append(f'import preflight failed: {exc}')

    result['ok'] = not result['errors']
    print(json.dumps(result))
    return 0 if result['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())

