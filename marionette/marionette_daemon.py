"""
Marionette — production supervisor for the SOMA <-> MAX pair.

Keeps both services alive, monitors the bridge, and self-heals — safely:
  * TARGETED restarts: kills only the specific PID on a service's port,
    never a blanket `taskkill /IM node.exe` (that footgun is gone).
  * BOOT GRACE: never health-kills a service that is still starting
    (SOMA loads heavy systems 60-90s after binding its port).
  * COEXISTS with human/Claude restarts: if a fresh process is already
    booting on the port, Marionette waits instead of fighting it.
  * CRASH-LOOP BREAKER: if a service restarts too many times in a window,
    the circuit opens, Marionette stops thrashing and alerts.
  * INDEPENDENT ALERTING: posts to a Discord webhook + a JSONL audit log,
    so you still hear about it even when SOMA itself is down.

Pure stdlib. Run:  python marionette_daemon.py
"""
import os
import shutil
import sys
import json
import time
import threading
import subprocess
from repair_deployment import RepairDeployment
from pathlib import Path
import socket
import urllib.request
import uuid
from collections import deque
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from marionette_config import CONFIG

SELF_PID = os.getpid()
HIDDEN_PROCESS_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def now() -> float:
    return time.time()


def iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Windows process helpers (PowerShell-backed, robust on this stack)
# ─────────────────────────────────────────────────────────────────────────────

def _ps(cmd: str, timeout: int = 6) -> str:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True, text=True, timeout=timeout, creationflags=HIDDEN_PROCESS_FLAGS,
        )
        return (out.stdout or "").strip()
    except Exception:
        return ""


def pid_on_port(port: int):
    """Return the listening PID on `port`, or None."""
    # Get-NetTCPConnection can spend >6 seconds loading CIM even on a healthy
    # host. Use the inexpensive OS listener table first; match exact port/state.
    try:
        result = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True,
                                text=True, timeout=5, creationflags=HIDDEN_PROCESS_FLAGS)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                fields = line.split()
                if len(fields) == 5 and fields[0].upper() == 'TCP' and fields[3].upper() == 'LISTENING':
                    if fields[1].rsplit(':', 1)[-1] == str(port):
                        return int(fields[4])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    out = _ps(f"(Get-NetTCPConnection -LocalPort {port} -State Listen -EA 0 "
              f"| Select-Object -First 1 -ExpandProperty OwningProcess)")
    try:
        return int(out) if out else None
    except ValueError:
        return None


def process_age_seconds(pid: int):
    """Seconds since the process started, or None if unknown."""
    out = _ps(f"$p=Get-Process -Id {pid} -EA 0; if($p){{((Get-Date) - $p.StartTime).TotalSeconds}}")
    try:
        return float(out) if out else None
    except ValueError:
        return None


def process_commandline(pid: int) -> str:
    return _ps(f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' -EA 0).CommandLine") or ""


def kill_pid(pid: int) -> bool:
    """Kill exactly one PID, after refusing to touch protected processes."""
    if not pid or pid <= 0 or pid == SELF_PID:
        return False
    cmdline = process_commandline(pid).lower()
    if not cmdline:
        return False  # Unknown process identity is never permission to kill.
    for guard in CONFIG["KILL_PROTECT_SUBSTRINGS"]:
        if guard.lower() in cmdline:
            return False  # never kill Claude / the supervisor / the editor
    try:
        result = subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                       capture_output=True, timeout=10, creationflags=HIDDEN_PROCESS_FLAGS)
        return result.returncode == 0
    except Exception:
        return False


def http_ok(url: str, timeout: int, method: str = "GET") -> bool:
    try:
        req = urllib.request.Request(url, data=b"" if method.upper() == "POST" else None, method=method.upper())
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def tcp_ok(host: str, port: int, timeout: float = 0.75) -> bool:
    """Cheap second liveness signal that does not depend on the Node event loop."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Per-service supervisor
# ─────────────────────────────────────────────────────────────────────────────

class ServiceMonitor:
    def __init__(self, name, spec):
        self.name = name
        self.spec = spec
        self.required = spec.get("required", True)
        # "Installed" = this machine actually has the service. Optional services
        # that aren't installed are skipped entirely (the SOMA-without-MAX case).
        detect = os.path.join(spec.get("start_dir", ""), spec.get("detect_file", ""))
        self.installed = ((bool(spec.get("detect_file")) and os.path.isfile(detect))
                          or (bool(spec.get("detect_command")) and shutil.which(spec["detect_command"]) is not None))
        # state: not_installed|unknown|healthy|stuck|dead|booting|restarting|circuit_open
        self.state = "healthy" if self.installed else "not_installed"
        if not self.installed:
            self.state = "not_installed"
        else:
            self.state = "unknown"
        self.consecutive_fails = 0
        self.last_healthy = 0.0
        self.last_state_change = now()
        self.grace_until = 0.0           # don't health-kill before this time
        self.restart_times = deque()     # timestamps of recent restarts
        self.circuit_open_until = 0.0
        self.total_restarts = 0
        self.last_probe = {"http": None, "listener": None, "failed_at": None}
        self.deploying = False           # managed deploy in progress (skip auto-recovery)
        self.deploy_state = "idle"       # idle|deploying|verifying|succeeded|rolled_back|failed
        self.last_reap = 0.0             # last orphan-reap sweep (throttled)

    # ── state helpers ──
    def _set(self, s):
        if s != self.state:
            self.last_state_change = now()
        self.state = s

    def _circuit_is_open(self) -> bool:
        return now() < self.circuit_open_until

    def _trip_circuit_if_looping(self) -> bool:
        win = CONFIG["RESTART_WINDOW_SECONDS"]
        cutoff = now() - win
        while self.restart_times and self.restart_times[0] < cutoff:
            self.restart_times.popleft()
        if len(self.restart_times) >= CONFIG["MAX_RESTARTS_IN_WINDOW"]:
            self.circuit_open_until = now() + CONFIG["CIRCUIT_COOLDOWN_SECONDS"]
            self._set("circuit_open")
            return True
        return False

    # ── orphan / zombie reaper ──
    def reap_orphans(self, supervisor):
        """Kill orphaned DUPLICATE instances of this service.

        Matches processes by the service's command SIGNATURE (never a blanket
        node kill), keeps the live port owner, and reaps the rest once they are
        old enough to not be a still-booting instance. SAFETY: it only acts when
        the live port owner ITSELF matches the signature — so the keeper is
        positively identified inside the same class. If nothing matching owns the
        port (e.g. a launcher/child split like SOMA's), it bails and kills nothing.
        Returns the number reaped.
        """
        if not CONFIG.get("REAP_ENABLED", True):
            return 0
        sig = self.spec.get("process_match")
        if not sig:
            return 0
        live = pid_on_port(self.spec["port"])
        if not live:
            return 0  # no live keeper on the port → cannot safely identify one
        # Enumerate node processes whose command line carries this signature.
        esc = sig.replace("'", "''")
        listing = _ps(
            "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
            f"Where-Object {{ $_.CommandLine -like '*{esc}*' }} | "
            "Select-Object -ExpandProperty ProcessId", timeout=10)
        pids = []
        for tok in listing.split():
            try:
                pids.append(int(tok))
            except ValueError:
                pass
        # The keeper must be in the matched set, or we don't understand the
        # topology well enough to reap safely — bail.
        if live not in pids:
            return 0
        min_age = CONFIG.get("REAP_MIN_AGE_S", 180)
        reaped = 0
        for pid in pids:
            if pid == live or pid == SELF_PID:
                continue
            age = process_age_seconds(pid)
            if age is None or age < min_age:
                continue  # unknown age or still booting — leave it
            if kill_pid(pid):  # kill_pid already refuses protected processes
                reaped += 1
        if reaped:
            supervisor.alert(self.name, "reaped_orphans",
                             f"reaped {reaped} orphaned {self.name} instance(s); "
                             f"kept live pid {live} on :{self.spec['port']}")
        return reaped

    # ── the per-tick evaluation ──
    def evaluate(self, supervisor):
        # Optional, not-installed services are invisible to the supervisor.
        if not self.installed:
            self._set("not_installed")
            return
        if self.spec.get("suspend_when_large_model_leased") and supervisor.large_model_lease_active():
            self.consecutive_fails = 0
            self._set("maintenance")
            return
        supervisor_monitors = getattr(supervisor, "monitors", {})
        waiting = [name for name in self.spec.get("depends_on", [])
                   if name in supervisor_monitors
                   and supervisor_monitors[name].installed
                   and supervisor_monitors[name].state != "healthy"]
        if waiting:
            self.consecutive_fails = 0
            self._set("waiting_dependency")
            return
        # Sweep orphaned duplicates regardless of health state (they pile up even
        # while the live instance is healthy). Throttled; never touches the keeper.
        if now() - self.last_reap >= CONFIG.get("REAP_INTERVAL_SECONDS", 60):
            self.last_reap = now()
            try:
                self.reap_orphans(supervisor)
            except Exception as e:
                supervisor.log_action(self.name, "reap_error", {"error": str(e)})
        # A managed deploy owns the lifecycle while it runs — don't double-restart.
        if self.deploying:
            self._set("deploying")
            return
        if self._circuit_is_open():
            self._set("circuit_open")
            return

        # Boot grace prevents a failed/slow startup from being killed, but a
        # positive application health probe is authoritative and may end grace
        # immediately. This keeps dependent services and bridge status honest.
        if now() < self.grace_until:
            healthy_during_grace = http_ok(
                self.spec["health_url"],
                CONFIG["HEALTH_TIMEOUT_SECONDS"],
                self.spec.get("health_method", "GET"),
            )
            if healthy_during_grace:
                self.grace_until = 0.0
                self.consecutive_fails = 0
                self.last_healthy = now()
                self.last_probe = {"http": True, "listener": True, "failed_at": None}
                self._set("healthy")
                return
            self._set("booting")
            return

        healthy = http_ok(self.spec["health_url"], CONFIG["HEALTH_TIMEOUT_SECONDS"], self.spec.get("health_method", "GET"))
        if healthy:
            self.consecutive_fails = 0
            self.last_healthy = now()
            self.last_probe = {"http": True, "listener": True, "failed_at": None}
            self._set("healthy")
            return

        self.consecutive_fails += 1
        listener_alive = tcp_ok("127.0.0.1", self.spec["port"])
        self.last_probe = {"http": False, "listener": listener_alive, "failed_at": iso()}

        # Someone else (you / Claude / start script) may already be launching it.
        # If a YOUNG process is sitting on the port, it's booting — wait, don't fight.
        pid = pid_on_port(self.spec["port"])
        if pid:
            age = process_age_seconds(pid)
            if age is not None and age < self.spec["boot_grace_s"]:
                self.grace_until = now() + (self.spec["boot_grace_s"] - age)
                self._set("booting")
                return

        dead_threshold = (CONFIG["FAILS_TO_DEAD_WITH_LISTENER"]
                          if listener_alive else CONFIG["FAILS_TO_DEAD"])
        if self.consecutive_fails < dead_threshold:
            if self.consecutive_fails >= CONFIG["FAILS_TO_STUCK"] and self.state != "stuck":
                self._set("stuck")
                supervisor.alert(self.name, "stuck",
                                 f"{self.name} HTTP health unresponsive ({self.consecutive_fails}/{dead_threshold}); "
                                 f"listener={'alive' if listener_alive else 'missing'} — watching before restart")
            return

        # Declared DEAD → recover (if circuit allows).
        self.recover(supervisor, reason=(
            f"{self.consecutive_fails} consecutive HTTP health failures; "
            f"listener={'alive' if listener_alive else 'missing'}"
        ))

    # ── recovery ──
    def recover(self, supervisor, reason=""):
        if self.deploying:
            return
        if self._circuit_is_open():
            return
        if self._trip_circuit_if_looping():
            supervisor.alert(self.name, "circuit_open",
                             f"{self.name} crash-looping — circuit OPEN for "
                             f"{CONFIG['CIRCUIT_COOLDOWN_SECONDS']//60} min. Needs a human.")
            return

        self._set("restarting")
        supervisor.alert(self.name, "restarting", f"Restarting {self.name}: {reason}")

        # 1) Targeted kill of the (possibly hung) process on the port.
        pid = pid_on_port(self.spec["port"])
        if pid:
            expected = str(self.spec.get("kill_match", "")).lower()
            actual = process_commandline(pid).lower()
            if expected and expected not in actual:
                supervisor.alert(self.name, "kill_refused",
                                 f"Refusing to kill pid {pid} on :{self.spec['port']}; command does not match {expected!r}")
                self._set("circuit_open")
                self.circuit_open_until = now() + CONFIG["CIRCUIT_COOLDOWN_SECONDS"]
                return
            killed = kill_pid(pid)
            supervisor.log_action(self.name, "kill",
                                  {"pid": pid, "killed": killed})
            time.sleep(2)
            if not killed or tcp_ok('127.0.0.1', self.spec['port']):
                self._set('stuck')
                supervisor.alert(self.name, 'restart_blocked', 'Old listener did not stop; refusing duplicate launch')
                return False
        elif tcp_ok('127.0.0.1', self.spec['port']):
            self._set('stuck')
            supervisor.alert(self.name, 'restart_blocked', 'Listener alive but PID lookup failed; refusing duplicate launch')
            return False

        # 2) Relaunch via the canonical start script, detached.
        try:
            subprocess.Popen(
                self.spec["start_cmd"],
                cwd=self.spec["start_dir"],
                creationflags=HIDDEN_PROCESS_FLAGS,
                close_fds=True,
            )
            launched = True
        except Exception as e:
            launched = False
            supervisor.alert(self.name, "launch_failed", f"Could not launch {self.name}: {e}")

        self.restart_times.append(now())
        self.total_restarts += 1
        self.consecutive_fails = 0
        # Give it room to boot before we judge it again.
        self.grace_until = now() + self.spec["boot_grace_s"]
        self._set("booting")
        supervisor.log_action(self.name, "relaunch", {"launched": launched})
        return launched

    def snapshot(self):
        return {
            "state": self.state,
            "installed": self.installed,
            "required": self.required,
            "deploy_state": self.deploy_state,
            "consecutive_fails": self.consecutive_fails,
            "last_healthy_age_s": round(now() - self.last_healthy, 1) if self.last_healthy else None,
            "total_restarts": self.total_restarts,
            "restarts_in_window": len(self.restart_times),
            "circuit_open": self._circuit_is_open(),
            "circuit_reopen_in_s": max(0, round(self.circuit_open_until - now())) if self._circuit_is_open() else 0,
            "booting": now() < self.grace_until,
            "probe": self.last_probe,
            "recovery_threshold": (CONFIG["FAILS_TO_DEAD_WITH_LISTENER"]
                                   if self.last_probe.get("listener") else CONFIG["FAILS_TO_DEAD"]),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Supervisor: loop + alerting + HTTP API
# ─────────────────────────────────────────────────────────────────────────────

class Supervisor:
    def __init__(self):
        self.monitors = {name: ServiceMonitor(name, spec)
                         for name, spec in CONFIG["SERVICES"].items()}
        self.paused = False
        self._pause_until = 0.0
        self.started_at = now()
        self.bridge_ok = False
        self._lock = threading.Lock()
        self._last_resource_check = 0.0        # disk/RAM watchdog throttle
        self._resource_alert_state = {}        # {name: {"level","ts"}} for de-dup + cooldown
        self._last_autoheal = {}               # {name: ts} auto-heal cooldown
        self.boot_id = str(uuid.uuid4())

    def large_model_lease_active(self):
        try:
            with open(CONFIG["LARGE_MODEL_LEASE"], encoding="utf-8") as f:
                lease = json.load(f)
            return float(lease.get("expiresAt", 0)) > now() * 1000
        except Exception:
            return False

    def ordered_monitors(self):
        """Stable dependency-first order; config errors fail closed without recursion."""
        ordered, visiting, visited = [], set(), set()
        def visit(name):
            if name in visited:
                return
            if name in visiting:
                raise RuntimeError(f"service dependency cycle at {name}")
            visiting.add(name)
            monitor = self.monitors[name]
            for dependency in monitor.spec.get("depends_on", []):
                if dependency in self.monitors:
                    visit(dependency)
            visiting.remove(name)
            visited.add(name)
            ordered.append(monitor)
        for name in self.monitors:
            visit(name)
        return ordered

    def resume_deployments(self):
        """Recover a durable interrupted handoff even when SOMA cannot boot."""
        monitor = self.monitors.get('soma')
        if not monitor or monitor.deploying:
            return
        root = Path(monitor.spec['start_dir'])
        directory = root / 'data/self-modification/deployments'
        if not directory.exists():
            return
        for receipt_path in sorted(directory.glob('*/receipt.json')):
            try:
                receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
                if receipt.get('status') not in ('prepared', 'accepted', 'restarting', 'rolling_back'):
                    continue
                if receipt['status'] == 'prepared' and pid_on_port(monitor.spec['port']):
                    continue  # the original publisher may still be writing
                relative = receipt_path.with_name('manifest.json').relative_to(root).as_posix()
                result = self.request_deploy('soma', reason='Resume interrupted durable deployment',
                    deployment_manifest=relative,
                    rollback_only=receipt['status'] in ('prepared', 'rolling_back') or receipt.get('action') == 'rollback')
                if result.get('error'):
                    # Stop retrying an unsafe snapshot indefinitely. A human
                    # edit must never be overwritten to resume old deployment.
                    contract = RepairDeployment(root, relative)
                    contract.receipt('rollback_blocked', error=result['error'])
                    self.alert('soma', 'deployment_recovery_blocked', result['error'])
                return
            except Exception as e:
                self.alert('soma', 'deployment_recovery_blocked', str(e))

    def persist_recovery_state(self):
        target = CONFIG.get("RECOVERY_STATE")
        if not target:
            return
        value = {
            "version": 1,
            "boot_id": self.boot_id,
            "updated_at": iso(),
            "supervisor_pid": SELF_PID,
            "large_model_lease_active": self.large_model_lease_active(),
            "services": {name: monitor.snapshot() for name, monitor in self.monitors.items()},
        }
        temporary = f"{target}.{SELF_PID}.tmp"
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(temporary, "w", encoding="utf-8") as f:
                json.dump(value, f, indent=2)
            os.replace(temporary, target)
        except Exception:
            try:
                if os.path.exists(temporary):
                    os.remove(temporary)
            except Exception:
                pass

    def pause(self, seconds=240):
        self.paused = True
        self._pause_until = now() + seconds if seconds > 0 else 0
        self.log_action("supervisor", "paused", {"seconds": seconds})

    # ── alerting & audit ──
    def log_action(self, service, action, detail=None):
        rec = {"ts": iso(), "service": service, "action": action, "detail": detail or {}}
        try:
            with open(CONFIG["ACTION_LOG"], "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except Exception:
            pass
        print(f"[Marionette] {service}/{action}: {detail or ''}")
        self.persist_recovery_state()

    def alert(self, service, kind, message):
        self.log_action(service, kind, {"message": message})
        hook = CONFIG["DISCORD_WEBHOOK"]
        if hook:
            try:
                body = json.dumps({"content": f"🪢 **Marionette** [{service}/{kind}] {message}"}).encode()
                req = urllib.request.Request(hook, data=body,
                                             headers={"Content-Type": "application/json"}, method="POST")
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass

    # ── disk / RAM watchdog ──
    def dm_master(self, text):
        """DM the master directly via Discord REST (bot token from SOMA's creds).
        Works even when SOMA's process is down — no gateway/bot login needed."""
        try:
            creds_path = os.path.join(os.path.dirname(__file__), "..", ".soma", "discord_creds.json")
            with open(creds_path, encoding="utf-8") as f:
                creds = json.load(f)
            token = creds.get("token")
            master = creds.get("masterId")
            if not token or not master:
                return
            hdr = {"Authorization": f"Bot {token}", "Content-Type": "application/json"}
            req = urllib.request.Request(
                "https://discord.com/api/v10/users/@me/channels",
                data=json.dumps({"recipient_id": str(master)}).encode(),
                headers=hdr, method="POST")
            chan = json.load(urllib.request.urlopen(req, timeout=8)).get("id")
            if not chan:
                return
            req2 = urllib.request.Request(
                f"https://discord.com/api/v10/channels/{chan}/messages",
                data=json.dumps({"content": text[:1900]}).encode(),
                headers=hdr, method="POST")
            urllib.request.urlopen(req2, timeout=8)
        except Exception:
            pass  # alerting must never crash the supervisor

    def _resource_alert(self, name, level, message):
        """Alert on a worsening level or after a cooldown; announce recovery once."""
        rank = {"ok": 0, "warning": 1, "critical": 2}
        st = self._resource_alert_state.get(name, {"level": "ok", "ts": 0.0})
        cooldown = CONFIG.get("RESOURCE_ALERT_COOLDOWN_S", 1800)
        worsened = rank[level] > rank[st["level"]]
        stale = level != "ok" and (now() - st["ts"] > cooldown)
        recovered = level == "ok" and st["level"] != "ok"
        if worsened or stale or recovered:
            self._resource_alert_state[name] = {"level": level, "ts": now()}
            if recovered:
                self.alert("system", f"{name}_recovered", message)
                self.dm_master(f"✅ Marionette: {message}")
            else:
                self.alert("system", f"{name}_{level}", message)
                icon = "🔴" if level == "critical" else "🟠"
                self.dm_master(f"{icon} Marionette watchdog: {message}")
        else:
            # persistently-bad but within cooldown: keep the level, don't re-nag
            self._resource_alert_state[name] = {"level": level, "ts": st["ts"]}

    def _autoheal_disk(self):
        """Delete the regenerable HF training-dataset cache (the exact thing that
        filled the disk on 2026-08-13). Returns GB freed, or None if nothing to do."""
        target = os.path.expanduser(CONFIG.get("HF_DATASETS_CACHE", "~/.cache/huggingface/datasets"))
        if not os.path.isdir(target):
            return None
        disk = CONFIG.get("DISK_PATH", "C:\\")
        before = shutil.disk_usage(disk).free
        try:
            shutil.rmtree(target, ignore_errors=True)
        except Exception as e:
            self.log_action("system", "autoheal_disk_error", {"error": str(e)})
            return None
        freed = (shutil.disk_usage(disk).free - before) / (1024 ** 3)
        return max(0.0, freed)

    def _autoheal_ram(self):
        """Unload loaded Ollama models (reversible — they reload on demand)."""
        stopped = []
        try:
            out = subprocess.run(["ollama", "ps"], capture_output=True, text=True, timeout=10).stdout
            for line in out.splitlines()[1:]:          # skip header
                name = line.split()[0] if line.split() else ""
                if ":" in name:                        # model tags look like name:tag
                    try:
                        subprocess.run(["ollama", "stop", name], capture_output=True, timeout=15)
                        stopped.append(name)
                    except Exception:
                        pass
        except Exception as e:
            self.log_action("system", "autoheal_ram_error", {"error": str(e)})
        return stopped

    def _maybe_autoheal(self, name):
        """On CRITICAL, take the safe remediation for `name` (throttled) and DM the result."""
        if not CONFIG.get("RESOURCE_AUTOHEAL", True):
            return
        if now() - self._last_autoheal.get(name, 0.0) < CONFIG.get("AUTOHEAL_COOLDOWN_S", 600):
            return
        self._last_autoheal[name] = now()
        if name == "disk":
            freed = self._autoheal_disk()
            if freed and freed > 0.5:
                msg = f"auto-healed disk — cleared regenerable HF dataset cache, freed {freed:.0f} GB"
            elif freed is not None:
                msg = "auto-heal disk: HF cache already clear — need manual cleanup (models/logs)"
            else:
                msg = "auto-heal disk: nothing safe to auto-clear — manual cleanup needed NOW"
            self.alert("system", "autoheal_disk", msg)
            self.dm_master(f"🛠️ Marionette: {msg}")
        elif name == "ram":
            stopped = self._autoheal_ram()
            msg = (f"auto-healed RAM — unloaded {len(stopped)} Ollama model(s): {', '.join(stopped)}"
                   if stopped else "auto-heal RAM: no Ollama models to unload — pressure is elsewhere")
            self.alert("system", "autoheal_ram", msg)
            self.dm_master(f"🛠️ Marionette: {msg}")

    def _resource_watchdog(self):
        """Sample disk + RAM (throttled) and warn the master BEFORE either hits 100%."""
        if now() - self._last_resource_check < CONFIG.get("RESOURCE_CHECK_SECONDS", 60):
            return
        self._last_resource_check = now()

        # Disk — Python stdlib, no deps.
        try:
            du = shutil.disk_usage(CONFIG.get("DISK_PATH", "C:\\"))
            free_gb = du.free / (1024 ** 3)
            if free_gb < CONFIG.get("DISK_CRIT_GB", 20):
                self._resource_alert("disk", "critical",
                    f"CRITICAL: only {free_gb:.0f} GB disk free — clear space NOW "
                    f"(e.g. ~/.cache/huggingface/datasets, regenerable). A full disk "
                    f"silently breaks SOMA's state/goal writes.")
                self._maybe_autoheal("disk")
            elif free_gb < CONFIG.get("DISK_WARN_GB", 60):
                self._resource_alert("disk", "warning", f"disk getting low: {free_gb:.0f} GB free")
            else:
                self._resource_alert("disk", "ok", f"disk recovered: {free_gb:.0f} GB free")
        except Exception as e:
            self.log_action("system", "disk_check_error", {"error": str(e)})

        # RAM — via PowerShell (Marionette already shells out; avoids a psutil dep).
        out = _ps("$o=Get-CimInstance Win32_OperatingSystem; "
                  "[int](100-($o.FreePhysicalMemory/$o.TotalVisibleMemorySize*100))")
        try:
            ram_pct = int((out or "").strip())
        except (ValueError, AttributeError):
            ram_pct = None
        if ram_pct is not None:
            if ram_pct >= CONFIG.get("RAM_CRIT_PCT", 96):
                self._resource_alert("ram", "critical",
                    f"CRITICAL: RAM {ram_pct}% — the box is about to thrash and wedge SOMA.")
                self._maybe_autoheal("ram")
            elif ram_pct >= CONFIG.get("RAM_WARN_PCT", 90):
                self._resource_alert("ram", "warning", f"RAM high: {ram_pct}%")
            else:
                self._resource_alert("ram", "ok", f"RAM recovered: {ram_pct}%")

    # ── cold start: bring the installed stack up at supervisor launch ──
    def cold_start(self):
        installed = [m for m in self.ordered_monitors() if m.installed]
        skipped = [m.name for m in self.monitors.values() if not m.installed]
        names = ", ".join(m.name for m in installed) or "none"
        self.alert("supervisor", "online",
                   f"Marionette online — supervising: {names}"
                   + (f" | not installed (skipped): {', '.join(skipped)}" if skipped else ""))
        for m in installed:
            if m.spec.get("suspend_when_large_model_leased") and self.large_model_lease_active():
                m._set("maintenance")
                self.log_action(m.name, "cold_start_suspended", {"reason": "large model lease active"})
                continue
            waiting = [name for name in m.spec.get("depends_on", [])
                       if self.monitors.get(name) and self.monitors[name].installed
                       and not http_ok(self.monitors[name].spec["health_url"], CONFIG["HEALTH_TIMEOUT_SECONDS"], self.monitors[name].spec.get("health_method", "GET"))]
            if waiting:
                m._set("waiting_dependency")
                self.log_action(m.name, "cold_start_waiting", {"dependencies": waiting})
                continue
            if not http_ok(m.spec["health_url"], CONFIG["HEALTH_TIMEOUT_SECONDS"], m.spec.get("health_method", "GET")):
                if tcp_ok("127.0.0.1", m.spec["port"]):
                    m.last_probe = {"http": False, "listener": True, "failed_at": iso()}
                    m.grace_until = now() + CONFIG["COLD_START_LISTENER_GRACE_SECONDS"]
                    m._set("booting")
                    self.log_action(m.name, "cold_start_degraded", {
                        "reason": "HTTP health unavailable but listener is alive",
                        "grace_s": CONFIG["COLD_START_LISTENER_GRACE_SECONDS"],
                    })
                else:
                    self.log_action(m.name, "cold_start", {"reason": "down at supervisor launch"})
                    with self._lock:
                        m.recover(self, reason="cold start — service listener missing")

    # ── main loop ──
    def loop(self):
        self.cold_start()
        while True:
            try:
                self._resource_watchdog()   # disk/RAM alerts — run even while paused
                # Auto-resume a timed pause so supervision never stays off.
                if self.paused and self._pause_until and now() >= self._pause_until:
                    self.paused = False
                    self._pause_until = 0
                    self.log_action("supervisor", "resumed", {"reason": "pause expired"})
                if not self.paused:
                    self.resume_deployments()
                    with self._lock:
                        for m in self.ordered_monitors():
                            m.evaluate(self)
                        self._update_bridge()
                        self.persist_recovery_state()
            except Exception as e:
                self.log_action("supervisor", "loop_error", {"error": str(e)})
            time.sleep(CONFIG["PING_INTERVAL_SECONDS"])

    def _update_bridge(self):
        # The bridge concept only exists if MAX is installed. SOMA-only installs
        # report bridge = N/A (None), never "down".
        max_mon = self.monitors.get("max")
        if not max_mon or not max_mon.installed:
            self.bridge_ok = None
            return
        # The SOMA<->MAX bridge can only work if both are healthy AND MAX answers.
        both_healthy = all(self.monitors[name].state == "healthy"
                           for name in ("soma", "max")
                           if name in self.monitors and self.monitors[name].installed)
        probe = http_ok(CONFIG["BRIDGE_PROBE_URL"], CONFIG["HEALTH_TIMEOUT_SECONDS"])
        new_bridge = both_healthy and probe
        if new_bridge != self.bridge_ok:
            self.alert("bridge", "up" if new_bridge else "down",
                       "SOMA<->MAX bridge healthy" if new_bridge else "SOMA<->MAX bridge DOWN")
        self.bridge_ok = new_bridge

    def status(self):
        return {
            "supervisor": {
                "uptime_s": round(now() - self.started_at, 1),
                "paused": self.paused,
                "self_pid": SELF_PID,
            },
            "bridge_ok": self.bridge_ok,
            "services": {name: m.snapshot() for name, m in self.monitors.items()},
        }

    def manual_restart(self, name, source=""):
        m = self.monitors.get(name)
        if not m:
            return {"error": f"unknown service '{name}'"}
        with self._lock:
            # Manual restart is an explicit human/operator intervention after a
            # fix. Give that fix one clean recovery window instead of immediately
            # re-tripping on stale crash-loop history.
            m.circuit_open_until = 0
            m.restart_times.clear()
            result = m.recover(self, reason="manual /reset request" + (f" [{source}]" if source else ""))
        if result is False or m.state in ('stuck', 'circuit_open') or m.deploying:
            return {"error": f"{name} restart blocked; inspect supervisor status", "state": m.state}
        return {"status": f"{name} restart triggered"}

    # ── managed deploy: health-gated restart with optional auto-rollback ──
    # This is the "good version" of self-keeping-up: a service (or SOMA on her
    # own behalf) asks Marionette — an independent process that survives the
    # restart — to restart it, VERIFY it comes back healthy, and AUTO-ROLL-BACK
    # to a known-good git ref if the new version is broken. Continuity lives in
    # Marionette; the service can update its own code and never strand itself.
    def request_deploy(self, name, rollback_ref=None, reason="", deployment_manifest=None, rollback_only=False):
        m = self.monitors.get(name)
        if not m:
            return {"error": f"unknown service '{name}'"}
        if not m.installed:
            return {"error": f"{name} not installed"}
        contract = None
        try:
            if deployment_manifest:
                contract = RepairDeployment(m.spec["start_dir"], deployment_manifest)
                previous = contract.previous_receipt()
                if previous and previous.get("status") in ("succeeded", "rolled_back", "rollback_blocked", "failed") and not rollback_only:
                    return previous
                if not rollback_only:
                    contract.verify()
            elif rollback_ref:
                return {"error": "Unscoped Git rollback is disabled; a verified deployment manifest is required"}
        except Exception as e:
            return {"error": str(e)}
        with self._lock:
            if m.deploying:
                return {"error": f"{name} deploy already in progress"}
            m.deploying = True
        if contract:
            try:
                contract.receipt("accepted", action="rollback" if rollback_only else "deploy")
            except Exception as e:
                m.deploying = False
                return {"error": f"Could not persist deployment acceptance: {e}"}
        t = threading.Thread(target=self._managed_deploy,
                             args=(m, rollback_ref, reason, contract, rollback_only), daemon=True)
        t.start()
        return {"status": f"managed deploy of {name} started",
                "rollback_ref": rollback_ref, "promotion_id": contract.id if contract else None,
                "contract_version": 2, "watch": "GET /status"}

    def _restart_and_verify(self, m) -> bool:
        """Targeted kill -> relaunch -> poll /health until healthy or timeout."""
        pid = pid_on_port(m.spec["port"])
        if pid:
            expected = str(m.spec.get('kill_match', '')).lower()
            if expected and expected not in process_commandline(pid).lower():
                return False
            if not kill_pid(pid):
                return False
            time.sleep(2)
            if tcp_ok('127.0.0.1', m.spec['port']):
                return False
        elif tcp_ok('127.0.0.1', m.spec['port']):
            return False
        try:
            subprocess.Popen(m.spec["start_cmd"], cwd=m.spec["start_dir"],
                             creationflags=HIDDEN_PROCESS_FLAGS,
                             close_fds=True)
        except Exception as e:
            self.alert(m.name, "launch_failed", f"deploy launch failed: {e}")
            return False
        m.deploy_state = "verifying"
        # Generous window: SOMA's full boot to /health=healthy can exceed 3 min
        # under load. Too tight a window falsely reports failure mid-boot.
        deadline = now() + m.spec["boot_grace_s"] + CONFIG["DEPLOY_VERIFY_EXTRA_S"]
        consecutive = 0
        while now() < deadline:
            new_pid = pid_on_port(m.spec["port"])
            healthy = new_pid and new_pid != pid and http_ok(m.spec["health_url"], CONFIG["HEALTH_TIMEOUT_SECONDS"], m.spec.get("health_method", "GET"))
            if healthy and m.name == 'soma':
                try:
                    with urllib.request.urlopen(m.spec['health_url'], timeout=CONFIG['HEALTH_TIMEOUT_SECONDS']) as response:
                        healthy = json.load(response).get('status') == 'healthy'
                except Exception:
                    healthy = False
            if healthy:
                consecutive += 1
                if consecutive >= 2:
                    return True
            else:
                consecutive = 0
            time.sleep(5)
        return False

    def _git_ref_exists(self, cwd, ref) -> bool:
        """Only roll back to a ref that actually resolves to a commit."""
        if not ref:
            return False
        try:
            r = subprocess.run(["git", "cat-file", "-e", f"{ref}^{{commit}}"],
                               cwd=cwd, capture_output=True, timeout=10)
            return r.returncode == 0
        except Exception:
            return False

    def _managed_deploy(self, m, rollback_ref, reason, contract=None, rollback_only=False):
        m.deploying = True
        m.deploy_state = "deploying"
        rollback_label = str(rollback_ref or (contract.manifest.get('rollback_ref') if contract else None) or 'snapshot')[:8]
        self.alert(m.name, "deploy_start",
                   f"Managed restart of {m.name}: {reason or 'requested'}"
                   + (f" (rollback ref {rollback_ref[:8]})" if rollback_ref else ""))
        try:
            if contract:
                if rollback_only:
                    contract.rollback()
                else:
                    contract.verify()
                contract.receipt("restarting", action="rollback" if rollback_only else "deploy")
            if self._restart_and_verify(m):
                if contract:
                    contract.verify("before" if rollback_only else "after")
                    contract.receipt("rolled_back" if rollback_only else "succeeded", pid=pid_on_port(m.spec["port"]), verified_at=now())
                m.deploy_state = "succeeded"
                m.last_healthy = now()
                self.alert(m.name, "deploy_ok", f"{m.name} restarted and verified HEALTHY")
                return

            # New version did not come healthy.
            if contract and not rollback_only:
                self.alert(m.name, "deploy_unhealthy",
                           f"{m.name} unhealthy after restart — ROLLING BACK to {rollback_label}")
                contract.receipt("rolling_back")
                contract.rollback()
                if self._restart_and_verify(m):
                    contract.verify("before")
                    contract.receipt("rolled_back", pid=pid_on_port(m.spec["port"]), verified_at=now())
                    m.deploy_state = "rolled_back"
                    m.last_healthy = now()
                    self.alert(m.name, "rolled_back",
                               f"{m.name} restored to known-good {rollback_label} and healthy")
                else:
                    contract.receipt("failed", error="Server unhealthy after file-scoped rollback")
                    m.deploy_state = "failed"
                    self.alert(m.name, "rollback_failed",
                               f"{m.name} STILL unhealthy after rollback — needs a human")
            else:
                if contract:
                    contract.receipt("failed", error="Server unhealthy after rollback restart")
                m.deploy_state = "failed"
                why = "no valid rollback ref" if rollback_ref else "no rollback ref provided"
                self.alert(m.name, "deploy_failed",
                           f"{m.name} did not come back healthy ({why})")
        except Exception as e:
            m.deploy_state = "rollback_blocked"
            if contract:
                contract.receipt("rollback_blocked", error=str(e))
            self.alert(m.name, "rollback_blocked", str(e))
        finally:
            m.deploying = False
            m.consecutive_fails = 0
            m.grace_until = now() + 5  # brief settle before normal supervision resumes


# ─────────────────────────────────────────────────────────────────────────────
# HTTP API
# ─────────────────────────────────────────────────────────────────────────────

def make_handler(sup: Supervisor):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence default access logging
            pass

        def _json(self, data, status=200):
            payload = json.dumps(data).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/ping":
                self._json({"status": "alive", "daemon": "marionette", "deployment_contract_version": 2})
            elif self.path in ("/status", "/"):
                self._json(sup.status())
            elif self.path.startswith("/status/"):
                name = self.path.split("/status/", 1)[1]
                m = sup.monitors.get(name)
                self._json(m.snapshot() if m else {"error": "unknown service"},
                           200 if m else 404)
            else:
                self._json({"error": "not found"}, 404)

        def _read_json_body(self):
            try:
                n = int(self.headers.get("Content-Length", 0))
                if n <= 0:
                    return {}
                return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            except Exception:
                return {}

        def do_POST(self):
            if self.path.startswith("/reset/"):
                name = self.path.split("/reset/", 1)[1]
                # Record who asked — several restarts had no attributable source.
                body = self._read_json_body()
                parts = [f"client={self.client_address[0]}", f"ua={str(self.headers.get('User-Agent', '?'))[:60]}"]
                if body.get("reason"):
                    parts.append(f"reason={str(body['reason'])[:120]}")
                if body.get("requestedBy"):
                    parts.append(f"requestedBy={str(body['requestedBy'])[:120]}")
                self._json(sup.manual_restart(name, source=" ".join(parts)))
            elif self.path.startswith("/deploy/"):
                # Health-gated managed restart with optional auto-rollback.
                # Body: {"rollback_ref": "<git sha>", "reason": "..."}
                name = self.path.split("/deploy/", 1)[1]
                body = self._read_json_body()
                self._json(sup.request_deploy(name, body.get("rollback_ref"), body.get("reason", ""), body.get("deployment_manifest"), body.get("rollback_only") is True))
            elif self.path.split("?", 1)[0] == "/pause":
                # Optional ?seconds=N -> auto-resume after N seconds, so a manual
                # restart (clean_restart.bat) can pause us without ever leaving
                # supervision off permanently. Default 240s.
                secs = 240
                if "?" in self.path:
                    try:
                        q = self.path.split("?", 1)[1]
                        for kv in q.split("&"):
                            if kv.startswith("seconds="):
                                secs = max(0, min(1800, int(kv.split("=", 1)[1])))
                    except Exception:
                        pass
                sup.pause(secs)
                self._json({"status": f"auto-recovery PAUSED for {secs}s (auto-resumes)"})
            elif self.path == "/resume":
                sup.paused = False
                sup.log_action("supervisor", "resumed", {"by": "api"})
                self._json({"status": "auto-recovery RESUMED"})
            else:
                self._json({"error": "not found"}, 404)

    return Handler


def main():
    print("[Marionette] Initializing production supervisor...")
    sup = Supervisor()

    sup.resume_deployments()

    t = threading.Thread(target=sup.loop, daemon=True)
    t.start()

    server = HTTPServer((CONFIG["HOST"], CONFIG["PORT"]), make_handler(sup))
    print(f"[Marionette] API on http://{CONFIG['HOST']}:{CONFIG['PORT']} "
          f"(/status, /ping, POST /reset/<svc>, /pause, /resume)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Marionette] Shutting down.")


if __name__ == "__main__":
    main()
