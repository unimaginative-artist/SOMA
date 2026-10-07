import fs from 'fs/promises';
import path from 'path';
import { buildSystemSnapshot } from './systemState.js';

const resolveAgent = (system, idOrName) => {
  if (!idOrName) return null;
  if (system[idOrName]) return system[idOrName];

  const entries = Object.entries(system);
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    if (value.name === idOrName || key === idOrName) return value;
  }
  return null;
};

const tryCall = async (obj, method) => {
  if (obj && typeof obj[method] === 'function') {
    return await obj[method]();
  }
  return null;
};

const clearCaches = async (system) => {
  const cleared = [];
  for (const [key, value] of Object.entries(system)) {
    if (!value || typeof value !== 'object') continue;
    for (const method of ['clearCache', 'flushCache', 'reset', 'clear']) {
      if (typeof value[method] === 'function') {
        try {
          await value[method]();
          cleared.push(key);
          break;
        } catch {
          // Ignore individual failures
        }
      }
    }
  }

  // RedisMockArbiter direct store clear
  if (system.redisMock?.store?.clear) {
    system.redisMock.store.clear();
    cleared.push('RedisMockArbiter');
  }

  return cleared;
};

export async function executeCommand(action, params = {}, system, emit = null) {
  const log = (type, message, extra = {}) => {
    if (emit) emit(type, { message, ...extra, timestamp: Date.now() });
  };

  switch (action) {
    case 'start_all': {
      if (system.autonomousHeartbeat?.start) system.autonomousHeartbeat.start();
      system.emergencyStop = false;
      log('log', 'System resumed (autonomy on)');
      return { success: true, message: 'System resumed' };
    }
    case 'stop_all': {
      if (system.autonomousHeartbeat?.stop) system.autonomousHeartbeat.stop();
      system.emergencyStop = true;
      log('log', 'System paused (autonomy off)');
      return { success: true, message: 'System paused' };
    }
    case 'reset_system': {
      if (system.autonomousHeartbeat?.stop) system.autonomousHeartbeat.stop();
      if (system.autonomousHeartbeat?.start) system.autonomousHeartbeat.start();
      log('log', 'Soft reset executed (heartbeat restarted)');
      return { success: true, message: 'Soft reset complete' };
    }
    case 'run_diagnostics': {
      log('diagnostic_log', 'Starting diagnostics...');
      let result = null;
      try {
        if (system.toolRegistry?.execute) {
          result = await system.toolRegistry.execute('system_scan', {});
        }
      } catch (e) {
        log('diagnostic_log', `Diagnostics error: ${e.message}`);
        return { success: false, message: e.message };
      }
      log('diagnostic_log', 'Diagnostics complete');
      return { success: true, message: 'Diagnostics complete', result };
    }
    case 'clear_cache': {
      const cleared = await clearCaches(system);
      log('log', `Cache cleared across ${cleared.length} component(s)`);
      return { success: true, message: 'Cache cleared', cleared };
    }
    case 'create_backup': {
      const snapshot = buildSystemSnapshot(system);
      const dir = path.join(process.cwd(), 'data', 'backups');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `system-state-${Date.now()}.json`);
      await fs.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
      log('log', `Backup created: ${file}`);
      return { success: true, message: 'Backup created', path: file };
    }
    case 'optimize_system': {
      let optimized = false;
      if (system.mnemonicArbiter?._optimize) {
        await system.mnemonicArbiter._optimize();
        optimized = true;
      } else if (system.mnemonicArbiter?.optimize) {
        await system.mnemonicArbiter.optimize();
        optimized = true;
      }
      log('log', optimized ? 'Memory optimization completed' : 'Optimization completed (no-op)');
      return { success: true, message: optimized ? 'Optimization completed' : 'Optimization completed (no-op)' };
    }
    case 'toggle_agent': {
      const agent = resolveAgent(system, params.id || params.name);
      if (!agent) return { success: false, message: 'Agent not found' };

      if (agent.isRunning === false || agent.running === false) {
        if (agent.start) await agent.start();
        else if (agent.initialize) await agent.initialize();
        agent.isRunning = true;
        return { success: true, message: 'Agent started' };
      }
      if (agent.stop) await agent.stop();
      else if (agent.shutdown) await agent.shutdown();
      agent.isRunning = false;
      return { success: true, message: 'Agent stopped' };
    }
    case 'restart_agent': {
      const agent = resolveAgent(system, params.id || params.name);
      if (!agent) return { success: false, message: 'Agent not found' };

      if (agent.restart) {
        await agent.restart();
      } else {
        if (agent.shutdown) await agent.shutdown();
        if (agent.initialize) await agent.initialize();
      }
      return { success: true, message: 'Agent restarted' };
    }
    case 'terminate_agent': {
      const agent = resolveAgent(system, params.id || params.name);
      if (!agent) return { success: false, message: 'Agent not found' };
      if (agent.stop) await agent.stop();
      else if (agent.shutdown) await agent.shutdown();
      else if (agent.terminate) await agent.terminate();
      agent.isRunning = false;
      return { success: true, message: 'Agent terminated' };
    }
    default:
      return { success: false, message: `Unknown command: ${action}` };
  }
}
