# SOMA distributed trading research

The trading cluster accelerates offline research only. Worker processes cannot
submit, cancel, or inspect broker orders. The coordinator remains responsible
for the experiment registry, sealed holdout, promotion gates, and every trading
runtime decision.

## Start each worker

Install the same SOMA revision on every machine, choose one strong shared token,
and allow the selected TCP port through the private-network firewall.

```powershell
$env:SOMA_TRADING_CLUSTER_TOKEN = '<the-same-random-secret-on-every-node>'
$env:SOMA_TRADING_WORKER_HOST = '0.0.0.0'
$env:SOMA_TRADING_WORKER_PORT = '7780'
npm run trading:cluster:worker
```

The process refuses a remote binding unless the token is at least 16
characters. Its `/health` response must report `liveOrderAuthority: false`.

## Start the coordinator

Set the worker list and the same token before starting SOMA. The background
research child inherits these variables automatically.

```powershell
$env:SOMA_TRADING_RESEARCH_WORKERS = 'http://192.168.1.250:7780,http://192.168.1.159:7780'
$env:SOMA_TRADING_CLUSTER_TOKEN = '<the-same-random-secret-on-every-node>'
npm run start:all
```

Run a research cycle manually with:

```powershell
node scripts/run-active-trading-research.mjs
```

The coordinator probes worker health and verifies the evaluator fingerprint,
dataset hash, candidate hashes, job identity, result count, and no-order
authority receipt. A missing, stale, slow, or invalid worker causes a local
retry/fallback; it does not leave the experiment unfinished.

## Operational rules

- Run the active research script only on the coordinator.
- Run the dedicated worker script on worker machines; do not run duplicate
  broker executors.
- Deploy the same commit to all nodes. Different evaluator fingerprints are
  rejected.
- Keep the worker port on a trusted private network or VPN.
- Never copy Alpaca credentials to research-only workers.
- Increasing worker count increases research throughput, not expected profit.
