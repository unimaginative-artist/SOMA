import { spawn } from 'child_process';
import path from 'path';

/**
 * VirtualShell
 * 
 * Provides a persistent, stateful shell environment for SOMA agents.
 * Allows "cd", "ls", "grep", and running tests within a tracked session.
 * 
 * Inspired by OpenHands' runtime environment.
 */
export class VirtualShell {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.history = [];
    this._maxHistory = 200;
    
    // PRODUCTION HARDENING: Command Blacklist
    this.blacklist = [
        'rm -rf /', 'rm -rf /*', ':(){ :|:& };:', 'mkfs', 'dd if=/dev/zero', 
        'shutdown', 'reboot', 'init 0', '> /dev/sda', 'mv / /dev/null'
    ];
  }

  async execute(command, timeout = 10000) {
    // 1. Safety Check
    if (this.blacklist.some(bad => command.includes(bad))) {
        return { 
            stdout: '', 
            stderr: 'SECURITY VIOLATION: Command blocked by VirtualShell safety protocols.', 
            exitCode: 1, 
            cwd: this.cwd 
        };
    }

    // 2. Chained Command Parsing (&&)
    const subCommands = command.split('&&').map(s => s.trim());
    let finalResult = { stdout: '', stderr: '', exitCode: 0, cwd: this.cwd };

    for (const sub of subCommands) {
        const result = await this._executeSingle(sub, timeout);
        finalResult.stdout += (finalResult.stdout ? '\n' : '') + result.stdout;
        finalResult.stderr += (finalResult.stderr ? '\n' : '') + result.stderr;
        finalResult.exitCode = result.exitCode;
        finalResult.cwd = result.cwd;
        
        // Stop chain on failure
        if (result.exitCode !== 0) break;
    }

    return finalResult;
  }

  async _executeSingle(command, timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      let output = '';
      let error = '';

      // Handle 'cd' manually since child_process.spawn doesn't persist cwd changes across calls
      if (command.startsWith('cd ')) {
        const target = command.substring(3).trim().replace(/[\\\/]/g, path.sep);
        const newPath = path.resolve(this.cwd, target);
        console.log(`[VirtualShell] Changing directory: ${this.cwd} -> ${newPath}`);
        this.cwd = newPath;
        this.history.push({ command, output: '', cwd: this.cwd, exitCode: 0 });
        if (this.history.length > this._maxHistory) this.history.shift();
        return resolve({ stdout: '', stderr: '', exitCode: 0, cwd: this.cwd });
      }

      const proc = spawn(command, {
        cwd: this.cwd,
        shell: true,
        timeout
      });

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { error += data.toString(); });

      proc.on('close', (code) => {
        this.history.push({ command, output, error, cwd: this.cwd, exitCode: code });
        if (this.history.length > this._maxHistory) this.history.shift();
        resolve({
          stdout: output.trim(),
          stderr: error.trim(),
          exitCode: code,
          cwd: this.cwd,
          duration: Date.now() - start
        });
      });

      proc.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: 1, cwd: this.cwd });
      });
    });
  }

  getHistory() {
    return this.history;
  }
}
