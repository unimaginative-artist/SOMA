const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

// Prevent EPIPE crashes when output streams close
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') return;
});
process.stderr.on('error', (err) => {
  if (err && err.code === 'EPIPE') return;
});

// Configuration
const PORTS = {
  FLASK: 5000,        // Flask ML Backend (The Goal)
  WHISPER: 5002,      // Whisper Voice Transcription Server
  BACKEND: 3001,      // SOMA Core Backend (launcher_ULTRA.mjs)
  CT_SERVER: 4200,    // Cognitive Terminal (optional)
  VITE_DEV: 5173      // Vite Dev Server
};

const PATHS = {
  ROOT: __dirname,
  FLASK_SERVER: path.join(__dirname, 'backend', 'prophet-engine', 'server.py'),
  WHISPER_SERVER: path.join(__dirname, 'a cognitive terminal', 'services', 'whisper_flask_server.py'),
  WHISPER_PYTHON: path.join(__dirname, '.soma_venv', 'Scripts', 'python.exe'),
  BACKEND: path.join(__dirname, 'launcher_ULTRA.mjs'),
  CT_DIR: path.join(__dirname, 'a cognitive terminal')
};

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = path.join(PATHS.ROOT, 'logs', 'start-all', RUN_ID);
fs.mkdirSync(LOG_DIR, { recursive: true });

const logStreams = new Map();
const getLogStreams = (name) => {
  if (logStreams.has(name)) return logStreams.get(name);
  const out = fs.createWriteStream(path.join(LOG_DIR, `${name.toLowerCase()}.out.log`), { flags: 'a' });
  const err = fs.createWriteStream(path.join(LOG_DIR, `${name.toLowerCase()}.err.log`), { flags: 'a' });
  logStreams.set(name, { out, err });
  return { out, err };
};

const writeLine = (stream, line) => {
  try {
    if (!stream || stream.destroyed) return;
    stream.write(line + "\n");
  } catch (err) {
    if (err && err.code === 'EPIPE') return;
    try { console.error(err); } catch {}
  }
};

const log = (service, msg, color = colors.reset) => {
  const timestamp = new Date().toLocaleTimeString();
  writeLine(process.stdout, `${color}[${timestamp}] [${service}] ${msg}${colors.reset}`);
};

let processes = [];
let shuttingDown = false;

const shutdown = async (signal = 'SIGINT') => {
  if (shuttingDown) return;
  shuttingDown = true;
  
  log('SYSTEM', `\n🛑 ${signal} received. Initiating Nuclear Cleanup...`, colors.red);
  
  // 1. Kill tracked processes via tree
  processes.forEach((proc) => {
    try {
      if (proc && proc.pid) {
        log('SYSTEM', `Killing process tree: ${proc.pid}`, colors.yellow);
        if (os.platform() === 'win32') {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
        } else {
          process.kill(-proc.pid, 'SIGTERM');
        }
      }
    } catch (e) {}
  });

  // 2. Nuclear Fallback: Kill anything on SOMA ports (3001, 5173, 5000, 5002, 4200)
  if (os.platform() === 'win32') {
    log('SYSTEM', 'Scrubbing orphan SOMA processes...', colors.magenta);
    try {
      // Kill node processes holding SOMA ports
      const ports = [3001, 5173, 5000, 5002, 4200];
      ports.forEach(port => {
        try {
          execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { taskkill /F /PID $_ /T }"`, { stdio: 'ignore' });
        } catch (e) {}
      });
      
      // Final sweep for any node process with SOMA in command line
      execSync('powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*SOMA*\' } | Stop-Process -Force"', { stdio: 'ignore' });
    } catch (e) {}
  }

  log('SYSTEM', 'Cleanup complete. Goodbye.', colors.green);
  process.exit(0);
};

// Helper to spawn processes (updated to track more reliably)
const startService = (name, command, args, cwd, color) => {
  log('SYSTEM', `Starting ${name}...`, colors.yellow);

  const proc = spawn(command, args, {
    cwd,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, FORCE_COLOR: 'true' },
    detached: false // Keep linked to parent
  });

  processes.push(proc); // Ensure it's in the list

  const { out, err } = getLogStreams(name);

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach((line) => {
      if (!line.trim()) return;
      writeLine(process.stdout, `${color}[${name}] ${line}${colors.reset}`);
      writeLine(out, line);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach((line) => {
      if (!line.trim()) return;
      writeLine(process.stderr, `${colors.red}[${name} ERR] ${line}${colors.reset}`);
      writeLine(err, line);
    });
  });

  proc.stdout.on('error', (e) => {
    if (e && e.code === 'EPIPE') return;
    writeLine(process.stderr, `${colors.red}[${name} ERR] stdout error: ${e.message}${colors.reset}`);
  });

  proc.stderr.on('error', (e) => {
    if (e && e.code === 'EPIPE') return;
    writeLine(process.stderr, `${colors.red}[${name} ERR] stderr error: ${e.message}${colors.reset}`);
  });

  proc.on('error', (e) => {
    writeLine(process.stderr, `${colors.red}[${name} ERR] failed to start: ${e.message}${colors.reset}`);
  });

  return proc;
};

// Helper to wait for port to be ready
const waitForPort = (port, maxRetries = 30, delayMs = 1000) => {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const checkPort = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        resolve();
      });

      req.on('error', () => {
        retries++;
        if (retries >= maxRetries) {
          reject(new Error(`Port ${port} not ready after ${maxRetries} attempts`));
        } else {
          setTimeout(checkPort, delayMs);
        }
      });

      req.on('response', () => {
        resolve();
      });
    };

    setTimeout(checkPort, delayMs);
  });
};

class Supervisor {
  constructor(name, startFn, opts = {}) {
    this.name = name;
    this.startFn = startFn;
    this.baseDelay = opts.baseDelay || 1000;
    this.maxDelay = opts.maxDelay || 30000;
    this.maxRestarts = opts.maxRestarts || 20;
    this.restartOnExit = opts.restartOnExit !== false;
    this.attempts = 0;
    this.proc = null;
  }

  start() {
    if (shuttingDown) return;
    this.attempts += 1;
    this.proc = this.startFn();
    processes.push(this.proc);

    this.proc.on('close', (code, signal) => {
      if (shuttingDown) return;
      if (!this.restartOnExit) return;
      if (this.attempts >= this.maxRestarts) {
        log('SYSTEM', `${this.name} reached max restarts (${this.maxRestarts}).`, colors.red);
        return;
      }
      const delay = Math.min(this.maxDelay, this.baseDelay * Math.pow(2, Math.max(0, this.attempts - 1)));
      log('SYSTEM', `${this.name} exited (code ${code ?? 'n/a'}). Restarting in ${delay}ms...`, colors.yellow);
      setTimeout(() => this.start(), delay);
    });
  }

  markHealthy() {
    this.attempts = 0;
  }
}

async function main() {
  console.clear();
  writeLine(process.stdout, `${colors.cyan}
???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
???                                                           ???
???   ???????????????????????? ????????????????????? ????????????   ???????????? ??????????????????                   ???
???   ?????????????????????????????????????????????????????????????????? ???????????????????????????????????????                  ???
???   ?????????????????????????????????   ??????????????????????????????????????????????????????????????????                  ???
???   ?????????????????????????????????   ??????????????????????????????????????????????????????????????????                  ???
???   ????????????????????????????????????????????????????????? ????????? ??????????????????  ?????????                  ???
???   ???????????????????????? ????????????????????? ?????????     ??????????????????  ?????????                  ???
???                                                           ???
???     Self-Organizing Metacognitive Architecture            ???
???   ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????       ???
???   ???? GPU Acceleration      ??? Smart Load Balancing       ???
???   ???? Cluster Networking    ???? QuadBrain Reasoning        ???
???   ???? Multi-Modal RAG       ???? Safety Gating              ???
???   ???? Continuous Learning   ???? Real-Time Dashboard        ???
???                                                           ???
???   ???? DEV MODE - Hot Reload Active                          ???
???   ??? Flask ML Backend (Port ${PORTS.FLASK})                          ???
???   ??? SOMA Backend (Port ${PORTS.BACKEND})                              ???
???   ??? Vite Dev Server (Port ${PORTS.VITE_DEV})                          ???
???   ??? Electron Window (Dev Mode)                              ???
???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
${colors.reset}`);

  const flaskSupervisor = new Supervisor('FLASK', () =>
    startService('FLASK', 'python', [PATHS.FLASK_SERVER], path.join(PATHS.ROOT, 'backend', 'prophet-engine'), colors.blue)
  );

  const backendSupervisor = new Supervisor('BACKEND', () => {
    log('SYSTEM', 'Starting SOMA Backend Server...', colors.yellow);
    const proc = spawn('node', [PATHS.BACKEND], {
      cwd: PATHS.ROOT,
      shell: true,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: 'true', PORT: String(PORTS.BACKEND) }
    });

    processes.push(proc); // Add to shutdown list

    const { out, err } = getLogStreams('BACKEND');

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (!line.trim()) return;
        writeLine(process.stdout, `${colors.green}[BACKEND] ${line}${colors.reset}`);
        writeLine(out, line);
      });
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (!line.trim()) return;
        writeLine(process.stderr, `${colors.red}[BACKEND ERR] ${line}${colors.reset}`);
        writeLine(err, line);
      });
    });

    proc.stdout.on('error', (e) => {
      if (e && e.code === 'EPIPE') return;
      writeLine(process.stderr, `${colors.red}[BACKEND ERR] stdout error: ${e.message}${colors.reset}`);
    });

    proc.stderr.on('error', (e) => {
      if (e && e.code === 'EPIPE') return;
      writeLine(process.stderr, `${colors.red}[BACKEND ERR] stderr error: ${e.message}${colors.reset}`);
    });

    proc.on('error', (e) => {
      writeLine(process.stderr, `${colors.red}[BACKEND ERR] failed to start: ${e.message}${colors.reset}`);
    });

    return proc;
  });

  const daemonSupervisor = new Supervisor('DAEMON', () =>
    startService('DAEMON', 'node', [path.join(PATHS.ROOT, 'start_daemon.js')], PATHS.ROOT, colors.magenta)
  );

  const viteSupervisor = new Supervisor('VITE', () =>
    startService('VITE', 'npx', ['vite'], PATHS.ROOT, colors.cyan)
  );

  const electronSupervisor = new Supervisor('ELECTRON', () => {
    const proc = spawn('npx', ['electron', '.'], {
      cwd: PATHS.ROOT,
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        VITE_DEV_SERVER_URL: `http://localhost:${PORTS.VITE_DEV}`
      }
    });

    processes.push(proc); // Track for shutdown

    const { out, err } = getLogStreams('ELECTRON');

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (!line.trim()) return;
        writeLine(process.stdout, `${colors.magenta}[ELECTRON] ${line}${colors.reset}`);
        writeLine(out, line);
      });
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (!line.trim()) return;
        writeLine(process.stderr, `${colors.red}[ELECTRON ERR] ${line}${colors.reset}`);
        writeLine(err, line);
      });
    });

    proc.stdout.on('error', (e) => {
      if (e && e.code === 'EPIPE') return;
      writeLine(process.stderr, `${colors.red}[ELECTRON ERR] stdout error: ${e.message}${colors.reset}`);
    });

    proc.stderr.on('error', (e) => {
      if (e && e.code === 'EPIPE') return;
      writeLine(process.stderr, `${colors.red}[ELECTRON ERR] stderr error: ${e.message}${colors.reset}`);
    });

    proc.on('error', (e) => {
      writeLine(process.stderr, `${colors.red}[ELECTRON ERR] failed to start: ${e.message}${colors.reset}`);
    });

    return proc;
  }, { restartOnExit: false });

  // Flask ML backend — optional, skip gracefully if Python deps not installed
  if (fs.existsSync(PATHS.FLASK_SERVER)) {
    log('SYSTEM', 'Starting Flask ML Backend...', colors.yellow);
    flaskSupervisor.start();
  } else {
    log('SYSTEM', 'Flask ML Backend not found — skipping (optional feature)', colors.yellow);
  }

  // Whisper voice server — optional, skip gracefully if not set up
  const whisperSupervisor = new Supervisor('WHISPER', () =>
    startService('WHISPER', `"${PATHS.WHISPER_PYTHON}"`, [`"${PATHS.WHISPER_SERVER}"`], PATHS.ROOT, colors.blue)
  );
  if (fs.existsSync(PATHS.WHISPER_SERVER) && fs.existsSync(PATHS.WHISPER_PYTHON)) {
    log('SYSTEM', 'Starting Whisper Voice Server...', colors.yellow);
    whisperSupervisor.start();
  } else {
    log('SYSTEM', 'Whisper Voice Server not found — skipping (optional feature)', colors.yellow);
  }

  log('SYSTEM', '???? Starting SOMA Backend Server...', colors.yellow);
  backendSupervisor.start();

  log('SYSTEM', '???? Starting SOMA Daemon...', colors.magenta);
  daemonSupervisor.start();

  log('SYSTEM', '??? Starting Vite Dev Server...', colors.yellow);
  viteSupervisor.start();

  // Wait for Flask to be ready (NON-BLOCKING)
  (async () => {
    log('SYSTEM', 'Waiting for Flask ML backend (in background)...', colors.cyan);
    try {
      await waitForPort(PORTS.FLASK, 60, 1000);
      log('SYSTEM', `??? Flask ML Backend ready on port ${PORTS.FLASK}`, colors.green);
      flaskSupervisor.markHealthy();
    } catch (e) {
      log('SYSTEM', `??????  Flask not responding: ${e.message}`, colors.red);
    }
  })();

  // Wait for Whisper to be ready (NON-BLOCKING)
  (async () => {
    log('SYSTEM', 'Waiting for Whisper voice server...', colors.cyan);
    try {
      await waitForPort(PORTS.WHISPER, 60, 1000);
      log('SYSTEM', `??? Whisper Voice Server ready on port ${PORTS.WHISPER}`, colors.green);
      whisperSupervisor.markHealthy();
    } catch (e) {
      log('SYSTEM', `??????  Whisper not responding: ${e.message}`, colors.red);
    }
  })();

  // Wait for backend to be ready (NON-BLOCKING)
  (async () => {
    log('SYSTEM', 'Waiting for backend to initialize...', colors.cyan);
    try {
      await waitForPort(PORTS.BACKEND, 60, 1000);
      log('SYSTEM', `??? Backend ready on port ${PORTS.BACKEND}`, colors.green);
      backendSupervisor.markHealthy();
    } catch (e) {
      log('SYSTEM', `??????  Backend not responding: ${e.message}`, colors.red);
    }
  })();

  // Wait for Vite AND SOMA backend to be ready, then launch Electron
  (async () => {
    log('SYSTEM', 'Waiting for Vite dev server...', colors.cyan);
    try {
      await waitForPort(PORTS.VITE_DEV, 30, 1000);
      log('SYSTEM', `✅ Vite dev server ready on port ${PORTS.VITE_DEV}`, colors.green);
    } catch (e) {
      log('SYSTEM', `⚠️  Vite not ready: ${e.message} — launching Electron anyway`, colors.yellow);
    }

    log('SYSTEM', 'Waiting for SOMA backend to come online...', colors.cyan);
    try {
      await waitForPort(PORTS.BACKEND, 60, 2000);
      log('SYSTEM', `✅ SOMA backend ready on port ${PORTS.BACKEND}`, colors.green);
    } catch (e) {
      log('SYSTEM', `⚠️  Backend not ready: ${e.message} — launching Electron anyway`, colors.yellow);
    }

    log('SYSTEM', '🚀 Launching Electron in dev mode...', colors.magenta);
    electronSupervisor.start();
  })();

  log('SYSTEM', '??? Development environment booting!', colors.green);
  log('SYSTEM', `???? Logs: ${LOG_DIR}`, colors.cyan);
  log('SYSTEM', `???? Vite UI: http://localhost:${PORTS.VITE_DEV}`, colors.cyan);
  log('SYSTEM', `???? SOMA Backend: http://localhost:${PORTS.BACKEND}`, colors.green);
  log('SYSTEM', `???? Flask ML API: http://localhost:${PORTS.FLASK}`, colors.blue);
  log('SYSTEM', `???? Whisper Voice: http://localhost:${PORTS.WHISPER}`, colors.blue);

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep alive
  setInterval(() => { }, 1000);
}

main().catch((err) => {
  log('SYSTEM', `Fatal start-all error: ${err.message}`, colors.red);
  shutdown('FATAL');
});
