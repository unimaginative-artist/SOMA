# Machine B signal ingress

`POST /api/finance/signal` is a signed, schema-validated, paper-only boundary.
It does not call a live broker. `GET /api/finance/signal/journal` also requires
a signed request. Neither endpoint is available until
`SOMA_SIGNAL_INGRESS_SECRET` contains at least 32 bytes on Machine A.

Set the **same** randomly generated secret through each machine's private
environment or secret manager. Do not commit it, put it in a URL, or send it
through Discord. Start or restart SOMA and the Machine B sentinel after setting
it. `SOMA_PRIMARY_HOST` selects the SOMA host for the sentinel. The default
symbol allowlist is BTC/ETH/SOL in `-USD` or `-USDT-SWAP` form; set
`SOMA_SIGNAL_ALLOWED_SYMBOLS` to a comma-separated list to narrow it.

HMAC authenticates requests but does not encrypt market data or journal
responses. Use a trusted encrypted network or VPN and a firewall before
exposing port 3001 to another machine. Keep the journal endpoint restricted to
trusted operators. The route never accepts an instruction to switch to live
execution, even if a payload contains `mode: "live"`.

## POST contract

The sentinel sends a JSON object with `source`, `symbol`, `timeframe`,
`signal`, `confidence`, `timestamp` (epoch milliseconds), and optional metrics.
BUY/SELL require a finite positive `metrics.price`. Symbols must be allowed;
timeframes are `1m`, `5m`, `15m`, `1h`, `4h`, or `1d`. The timestamp cannot be
in the future or more than 120 seconds old.

Headers:

- `x-soma-idempotency-key`: a stable key for the source, instrument, timeframe,
  and confirmed bar (for example `machine_b_sentinel:ETH-USDT-SWAP:1h:2026-10-07T13:00:00Z`).
- `x-soma-signature`: lowercase hex HMAC-SHA256 using the shared secret over
  `key + "\n" + JSON.stringify(payload)`.

The sentinel sends one signal per confirmed bar. A repeated signed request
with the same key and payload returns the original receipt without another
paper entry. Reusing a key for a different payload returns 409. Receipts are
stored under `data/trading/signals/idempotency/` and survive process restarts.
If a receipt is only partially written after a crash, the route refuses to
guess or repeat the paper entry; it returns 409 for manual reconciliation.
Missing authentication configuration returns 503, and a bad signature returns
401. A remote validation or authentication error is reported by the sentinel
without treating it as an offline queue item.

## Journal read

Send `x-soma-journal-timestamp` as the current epoch millisecond timestamp and
`x-soma-journal-signature` as lowercase hex HMAC-SHA256 over
`"GET\n/api/finance/signal/journal\n" + timestamp`. Unsigned, stale, or
future requests receive 401. The response contains the most recent 50
completed signal decisions. The journal is an audit view; the individual
idempotency receipts are the durable duplicate guard.

## Deployment check

Run `node --test tests/signal-ingress-security.test.mjs tests/signal-ingress-and-divergence.test.mjs tests/cluster-trading-sentinel.test.mjs`.
Then verify that an unsigned POST and journal GET are rejected, that a signed
HOLD produces `OBSERVED_HOLD`, and that no live order is created. Keep trading
intent stopped during this check. No API route here authorizes live orders.
