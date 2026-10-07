"""
Marionette self-test — verifies the supervisor's safety-critical logic without
killing or launching anything real. Run: python marionette_test.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import marionette_daemon as md
from marionette_config import CONFIG

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond:
        passed += 1; print(f"  PASS  {name}")
    else:
        failed += 1; print(f"  FAIL  {name}")

print("Marionette safety tests\n" + "-" * 40)

# 1) kill_pid refuses protected / invalid PIDs (never actually kills here)
check("refuses PID 0", md.kill_pid(0) is False)
check("refuses self PID", md.kill_pid(md.SELF_PID) is False)

# 2) config sanity: dead threshold strictly greater than stuck threshold
check("FAILS_TO_DEAD > FAILS_TO_STUCK",
      CONFIG["FAILS_TO_DEAD"] > CONFIG["FAILS_TO_STUCK"])
check("listener threshold > ordinary dead threshold",
      CONFIG["FAILS_TO_DEAD_WITH_LISTENER"] > CONFIG["FAILS_TO_DEAD"])

# 3) circuit breaker trips after MAX_RESTARTS_IN_WINDOW restarts
m = md.ServiceMonitor("test", {"health_url": "http://127.0.0.1:1/health", "port": 1,
                               "boot_grace_s": 1, "start_dir": ".", "start_cmd": ["cmd", "/c", "echo"]})
for _ in range(CONFIG["MAX_RESTARTS_IN_WINDOW"]):
    m.restart_times.append(md.now())
check("circuit opens on crash loop", m._trip_circuit_if_looping() is True)
check("circuit reports open", m._circuit_is_open() is True)

# 4) boot grace suppresses recovery (stays 'booting', never restarts)
m2 = md.ServiceMonitor("test2", CONFIG["SERVICES"]["soma"])
m2.grace_until = md.now() + 60
class _NoopSup:
    def alert(self, *a, **k): pass
    def log_action(self, *a, **k): pass
original_http_ok = md.http_ok
md.http_ok = lambda *_args, **_kwargs: False
try:
    m2.evaluate(_NoopSup())
    check("failed health stays protected during grace", m2.state == "booting")
    md.http_ok = lambda *_args, **_kwargs: True
    m2.evaluate(_NoopSup())
    check("positive health ends grace immediately", m2.state == "healthy" and m2.grace_until == 0.0)
finally:
    md.http_ok = original_http_ok

# 5) protected substrings include claude + marionette
prot = [s.lower() for s in CONFIG["KILL_PROTECT_SUBSTRINGS"]]
check("protects claude", "claude" in prot)
check("protects marionette", "marionette" in prot)

# 6) an absent OPTIONAL service is 'not_installed' and never acts
absent = md.ServiceMonitor("ghost", {
    "required": False, "health_url": "http://127.0.0.1:1/health", "port": 1,
    "boot_grace_s": 1, "start_dir": r"C:\does\not\exist",
    "detect_file": "nope.bat", "start_cmd": ["cmd", "/c", "echo"],
})
check("absent optional -> not_installed", absent.state == "not_installed")
calls = {"recover": 0}
class _SpySup:
    def alert(self, *a, **k): pass
    def log_action(self, *a, **k): pass
absent.recover = lambda *a, **k: calls.__setitem__("recover", calls["recover"] + 1)
absent.evaluate(_SpySup())
check("not_installed never recovers", calls["recover"] == 0 and absent.state == "not_installed")

# 7) SOMA is detected as installed in this repo
soma = md.ServiceMonitor("soma", CONFIG["SERVICES"]["soma"])
check("SOMA detected installed", soma.installed is True)

# 7b) dependency ordering always launches infrastructure before dependants
supervisor = md.Supervisor()
ordered = [m.name for m in supervisor.ordered_monitors()]
check("Ollama ordered before SOMA", ordered.index("ollama") < ordered.index("soma"))
check("SOMA ordered before MAX", ordered.index("soma") < ordered.index("max"))

# 7c) optional GPU services enter maintenance while Qwen owns the durable lease
siren = supervisor.monitors["siren"]
siren.installed = True
supervisor.large_model_lease_active = lambda: True
siren.evaluate(supervisor)
check("Siren respects large-model maintenance lease", siren.state == "maintenance")

# 8) HTTP stalls cannot restart a process whose listener remains alive.
original_http_ok = md.http_ok
original_tcp_ok = md.tcp_ok
original_pid_on_port = md.pid_on_port
original_process_age = md.process_age_seconds
try:
    md.http_ok = lambda *_args, **_kwargs: False
    md.tcp_ok = lambda *_args, **_kwargs: True
    md.pid_on_port = lambda *_args, **_kwargs: 4242
    md.process_age_seconds = lambda *_args, **_kwargs: 9999
    listener_monitor = md.ServiceMonitor("listener-test", CONFIG["SERVICES"]["soma"])
    listener_monitor.installed = True
    recoveries = []
    listener_monitor.recover = lambda *_args, **kwargs: recoveries.append(kwargs.get("reason", ""))
    for _ in range(CONFIG["FAILS_TO_DEAD"] + 2):
        listener_monitor.evaluate(_NoopSup())
    check("live listener survives ordinary HTTP failure threshold", not recoveries)
    while listener_monitor.consecutive_fails < CONFIG["FAILS_TO_DEAD_WITH_LISTENER"]:
        listener_monitor.evaluate(_NoopSup())
    check("persistent HTTP stall eventually recovers", len(recoveries) == 1)

    # A missing listener remains a fast, normal recovery.
    md.tcp_ok = lambda *_args, **_kwargs: False
    md.pid_on_port = lambda *_args, **_kwargs: None
    missing_monitor = md.ServiceMonitor("missing-test", CONFIG["SERVICES"]["soma"])
    missing_monitor.installed = True
    missing_recoveries = []
    missing_monitor.recover = lambda *_args, **kwargs: missing_recoveries.append(kwargs.get("reason", ""))
    for _ in range(CONFIG["FAILS_TO_DEAD"]):
        missing_monitor.evaluate(_NoopSup())
    check("missing listener recovers at ordinary threshold", len(missing_recoveries) == 1)
finally:
    md.http_ok = original_http_ok
    md.tcp_ok = original_tcp_ok
    md.pid_on_port = original_pid_on_port
    md.process_age_seconds = original_process_age

print("-" * 40)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
