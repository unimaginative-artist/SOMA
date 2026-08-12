"""
Marionette supervisor configuration.

Production watchdog for the SOMA <-> MAX pair. Pure stdlib, zero deps, so a
broken npm/pip install can never take the supervisor down with it.
"""
import os

CONFIG = {
    # ── Supervisor HTTP API ────────────────────────────────────────────────
    "HOST": "127.0.0.1",          # localhost-only; not exposed to the network
    "PORT": 9000,

    # ── Loop timing (seconds) ──────────────────────────────────────────────
    "PING_INTERVAL_SECONDS": 5,        # how often we health-check each service
    "HEALTH_TIMEOUT_SECONDS": 4,       # per-ping HTTP timeout
    "FAILS_TO_STUCK": 2,               # consecutive fails -> "stuck" (warn)
    "FAILS_TO_DEAD": 4,                # consecutive fails -> "dead" (recover)
    # A listening socket means the process still exists and may only be under
    # temporary event-loop or CPU pressure. Give it roughly two minutes before
    # replacing it; a process with no listener still uses FAILS_TO_DEAD.
    "FAILS_TO_DEAD_WITH_LISTENER": 12,
    "COLD_START_LISTENER_GRACE_SECONDS": 90,

    # Managed-deploy health window: a service gets boot_grace_s + this many
    # seconds to come back healthy before a deploy is declared failed. Generous
    # because SOMA's full heavy-system boot can exceed 3 minutes under load.
    "DEPLOY_VERIFY_EXTRA_S": 150,

    # ── Crash-loop circuit breaker ─────────────────────────────────────────
    "MAX_RESTARTS_IN_WINDOW": 3,       # restarts allowed within the window...
    "RESTART_WINDOW_SECONDS": 600,     # ...before the circuit opens (10 min)
    "CIRCUIT_COOLDOWN_SECONDS": 900,   # how long the circuit stays open (15 min)

    # ── Orphan / zombie reaper ─────────────────────────────────────────────
    # The restart path only kills the process ON THE PORT. Instances that
    # spawned but never bound the port (crash-loop leftovers, duplicate chat
    # servers) are invisible to it and PILE UP — 34 MAX `launcher.mjs --mode
    # chat` instances once ate 19GB and wedged SOMA (2026-08-12). The reaper
    # sweeps duplicates by COMMAND SIGNATURE (never a blanket node kill — that
    # footgun stays gone). SAFETY RULE: it reaps only when the live port owner
    # ITSELF matches the signature, so the keeper is positively identified in
    # the same class; otherwise it bails. That is why SOMA — whose :3001 owner
    # is a CHILD of the launcher_ULTRA process, not launcher_ULTRA itself — has
    # no process_match yet: enabling it naively would kill SOMA's launcher.
    "REAP_ENABLED": True,
    "REAP_INTERVAL_SECONDS": 60,       # sweep cadence per service
    "REAP_MIN_AGE_S": 180,             # never reap an instance younger than this (may be booting)

    # ── Discord alerting (independent of SOMA being up) ────────────────────
    # Set MARIONETTE_DISCORD_WEBHOOK to get posts when Marionette takes action.
    # Falls back to file-only logging if unset.
    "DISCORD_WEBHOOK": os.getenv("MARIONETTE_DISCORD_WEBHOOK", ""),

    # ── Audit log ──────────────────────────────────────────────────────────
    "ACTION_LOG": os.path.join(os.path.dirname(__file__), "marionette_actions.jsonl"),

    # ── Supervised services ────────────────────────────────────────────────
    # boot_grace_s: how long to leave a freshly-started service alone before
    #   health-checking it (SOMA loads heavy systems 60-90s AFTER binding 3001).
    # start_dir/start_cmd: the canonical, correct way to (re)launch each service.
    # required=True  -> must exist; absence is a config error worth flagging.
    # required=False -> OPTIONAL. If not installed (start script missing),
    #   Marionette skips it entirely: no pings, no restarts, no alerts. This is
    #   what lets SOMA-only downloads run the supervisor with no MAX present.
    # detect_file -> the file whose existence means "this service is installed
    #   on this machine" (checked under start_dir).
    "SERVICES": {
        "soma": {
            "required": True,
            # 127.0.0.1, NOT localhost: on Windows dual-stack, "localhost" tries
            # IPv6 ::1 first and eats ~200ms/ping falling back to IPv4 (measured
            # 2026-08-12: localhost 205ms vs 127.0.0.1 7ms). That 200ms baseline
            # + a GC pause under heap pressure intermittently blew past the 4s
            # HEALTH_TIMEOUT, producing false "unresponsive (2/12)" reads that
            # threatened restarts and made SOMA feel offline on Discord. MAX
            # already uses 127.0.0.1 — this matches it. 40x latency margin.
            "health_url": "http://127.0.0.1:3001/health",
            "port": 3001,
            "boot_grace_s": 130,
            "start_dir": r"C:\Users\barry\Desktop\The Stack\SOMA",
            "detect_file": "start_production.bat",
            # Recovery uses the LEAN launcher (no WSL/Redis/Siren preamble that
            # can hang) so bringing SOMA back never blocks on optional extras.
            "start_cmd": ["cmd", "/c", "start-soma-core.bat"],
        },
        "max": {
            "required": False,
            "health_url": "http://127.0.0.1:3100/health",
            "port": 3100,
            "boot_grace_s": 35,
            "start_dir": r"C:\Users\barry\Desktop\The Stack\MAX",
            "detect_file": "start-local.bat",
            "start_cmd": ["cmd", "/c", "start-local.bat"],
            # Reaper signature: every MAX chat server launches with this exact
            # command; only ONE should own :3100. Duplicates are orphans → reaped.
            "process_match": "launcher.mjs --mode chat",
        },
    },

    # ── Bridge check ───────────────────────────────────────────────────────
    # The SOMA->MAX bridge can only work when BOTH are healthy. We also probe
    # MAX's health as a deeper liveness signal for the bridge target.
    "BRIDGE_PROBE_URL": "http://127.0.0.1:3100/health",

    # ── Hard safety: process command-line substrings we must NEVER kill ─────
    "KILL_PROTECT_SUBSTRINGS": ["claude", "marionette", "code.exe", "cursor"],
}
