"""
average_adapters.py — Federated averaging (FedAvg) of LoRA adapters.

Averages N peft LoRA adapters tensor-for-tensor into one global adapter. This is
the aggregation half of real federated learning: each node trains a LoRA adapter
locally (finetune_gemma3.py), the coordinator averages them here, and the global
adapter is redistributed.

CPU-only by design — uses safetensors.numpy + numpy, NO torch / GPU required, so
the coordinator can aggregate without a training stack.

Usage:
  python average_adapters.py --adapters DIR1 DIR2 ... --output OUT [--weights w1,w2,...]
  python average_adapters.py --adapters D1 D2 --output OUT --dry-run   # plumbing only
"""
import sys
import json
import argparse
from pathlib import Path

# UTF-8 stdout so emoji log lines survive a non-TTY subprocess on Windows.
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

ADAPTER_FILE = 'adapter_model.safetensors'


def _emit(json_path, result):
    """Machine-readable result for the Node.js coordinator (FederatedLearning.cjs)."""
    try:
        if json_path:
            p = Path(json_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(result), encoding='utf-8')
    except Exception as e:
        print(f'⚠️  Could not write --json-result: {e}')
    try:
        print('__SOMA_AGG_RESULT__' + json.dumps(result))
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description='FedAvg of LoRA adapters (CPU/numpy).')
    ap.add_argument('--adapters', nargs='+', required=True,
                    help='Adapter directories to average (each must contain adapter_model.safetensors)')
    ap.add_argument('--output', required=True, help='Output directory for the averaged global adapter')
    ap.add_argument('--weights', default=None,
                    help='Comma-separated sample counts for weighted FedAvg (default: uniform)')
    ap.add_argument('--json-result', default=None, help='Write a machine-readable result JSON here')
    ap.add_argument('--dry-run', action='store_true', help='Verify plumbing only, no averaging')
    args = ap.parse_args()

    if args.dry_run:
        _emit(args.json_result, {
            'ok': True, 'dry_run': True, 'output_dir': args.output,
            'weights_path': args.output, 'participants': len(args.adapters),
            'tensors': 0, 'note': 'dry-run: bridge plumbing verified, no averaging performed',
        })
        print('✅ Adapter-average dry-run complete (no averaging performed).')
        return

    try:
        from safetensors.numpy import load_file, save_file
        import numpy as np
    except Exception as e:
        _emit(args.json_result, {'ok': False, 'error': 'deps_unavailable',
                                 'message': f'{type(e).__name__}: {e}'})
        print(f'❌ safetensors/numpy unavailable: {e}')
        sys.exit(3)

    # Resolve + validate adapter files.
    files = []
    for d in args.adapters:
        f = Path(d) / ADAPTER_FILE
        if not f.exists():
            _emit(args.json_result, {'ok': False, 'error': 'adapter_not_found', 'message': str(f)})
            print(f'❌ adapter not found: {f}')
            sys.exit(4)
        files.append(f)
    if not files:
        _emit(args.json_result, {'ok': False, 'error': 'no_adapters'})
        sys.exit(4)

    # Weights: sample-count-weighted FedAvg if given, else uniform. Normalized.
    if args.weights:
        try:
            w = [float(x) for x in args.weights.split(',')]
        except ValueError as e:
            _emit(args.json_result, {'ok': False, 'error': 'bad_weights', 'message': str(e)})
            sys.exit(5)
        if len(w) != len(files):
            _emit(args.json_result, {'ok': False, 'error': 'weights_len_mismatch',
                                     'message': f'{len(w)} weights for {len(files)} adapters'})
            sys.exit(5)
    else:
        w = [1.0] * len(files)
    total = sum(w)
    w = [x / total for x in w] if total > 0 else [1.0 / len(files)] * len(files)

    # Load all adapters; average over the INTERSECTION of tensor keys (mismatched
    # keys are skipped and reported rather than crashing the round).
    tensors = [load_file(str(f)) for f in files]
    keys = set(tensors[0].keys())
    for t in tensors[1:]:
        keys &= set(t.keys())
    skipped = (set(tensors[0].keys()) - keys)
    keys = sorted(keys)

    agg = {}
    for k in keys:
        acc = None
        base_dtype = tensors[0][k].dtype
        shape0 = tensors[0][k].shape
        ok = True
        for wi, t in zip(w, tensors):
            arr = t[k]
            if arr.shape != shape0:
                ok = False
                break
            arr = arr.astype(np.float32)
            acc = arr * wi if acc is None else acc + arr * wi
        if not ok:
            skipped.add(k)
            continue
        agg[k] = acc.astype(base_dtype)

    if not agg:
        _emit(args.json_result, {'ok': False, 'error': 'no_common_tensors',
                                 'message': 'adapters share no compatible tensors'})
        print('❌ adapters share no compatible tensors')
        sys.exit(6)

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    save_file(agg, str(out / ADAPTER_FILE))

    # Copy adapter_config.json from the first adapter so the result is loadable.
    cfg = Path(args.adapters[0]) / 'adapter_config.json'
    if cfg.exists():
        (out / 'adapter_config.json').write_text(cfg.read_text(encoding='utf-8'), encoding='utf-8')

    result = {
        'ok': True, 'output_dir': str(out), 'weights_path': str(out),
        'participants': len(files), 'tensors': len(agg),
        'skipped_tensors': len(skipped), 'weighting': w,
    }
    _emit(args.json_result, result)
    print(f'✅ Averaged {len(agg)} tensors from {len(files)} adapters → {out}'
          + (f' ({len(skipped)} skipped)' if skipped else ''))


if __name__ == '__main__':
    main()
