/**
 * PreFlightCheck.js - SOMA Startup Validator
 * 
 * Validates the system before boot to catch issues early.
 * Run this before starting the server to prevent crashes.
 */

import { promises as fs } from 'fs';
import path from 'path';
import net from 'net';

export class PreFlightCheck {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.passed = [];
  }

  log(type, message) {
    const icons = { error: '❌', warn: '⚠️', pass: '✅', info: 'ℹ️' };
    console.log(`${icons[type] || ''} ${message}`);
    
    if (type === 'error') this.errors.push(message);
    if (type === 'warn') this.warnings.push(message);
    if (type === 'pass') this.passed.push(message);
  }

  /**
   * Check if a required npm package is installed
   */
  async checkPackage(packageName) {
    try {
      const packagePath = path.join(process.cwd(), 'node_modules', packageName);
      await fs.access(packagePath);
      this.log('pass', `Package '${packageName}' installed`);
      return true;
    } catch {
      this.log('error', `Missing package: ${packageName} - run: npm install ${packageName}`);
      return false;
    }
  }

  /**
   * Check if a port is available
   */
  async checkPort(port, serviceName) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.log('warn', `Port ${port} (${serviceName}) is already in use`);
          resolve(false);
        } else {
          resolve(true);
        }
      });

      server.once('listening', () => {
        server.close();
        this.log('pass', `Port ${port} (${serviceName}) is available`);
        resolve(true);
      });

      server.listen(port);
    });
  }

  /**
   * Check if a required file exists
   */
  async checkFile(filePath, description) {
    try {
      await fs.access(filePath);
      this.log('pass', `${description} exists`);
      return true;
    } catch {
      this.log('error', `Missing: ${description} (${filePath})`);
      return false;
    }
  }

  /**
   * Check if a directory exists and is writable
   */
  async checkDirectory(dirPath, description) {
    try {
      await fs.access(dirPath, fs.constants.W_OK);
      this.log('pass', `${description} is writable`);
      return true;
    } catch {
      try {
        await fs.mkdir(dirPath, { recursive: true });
        this.log('pass', `${description} created`);
        return true;
      } catch (e) {
        this.log('error', `Cannot access/create ${description}: ${e.message}`);
        return false;
      }
    }
  }

  /**
   * Check environment variables
   */
  checkEnvVar(varName, required = false) {
    if (process.env[varName]) {
      this.log('pass', `Environment variable ${varName} is set`);
      return true;
    } else if (required) {
      this.log('error', `Missing required environment variable: ${varName}`);
      return false;
    } else {
      this.log('warn', `Optional environment variable ${varName} not set`);
      return false;
    }
  }

  /**
   * Run all pre-flight checks
   */
  async runAll() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     SOMA PRE-FLIGHT CHECK              ║');
    console.log('╚════════════════════════════════════════╝\n');

    // 1. Required packages
    console.log('📦 Checking required packages...');
    await this.checkPackage('express');
    await this.checkPackage('socket.io');
    await this.checkPackage('ws');
    await this.checkPackage('better-sqlite3');
    await this.checkPackage('cors');

    // 2. Ports
    console.log('\n🔌 Checking ports...');
    await this.checkPort(3001, 'SOMA Backend');
    await this.checkPort(5173, 'Vite Dev Server');
    await this.checkPort(5000, 'Flask ML Backend');

    // 3. Required directories
    console.log('\n📁 Checking directories...');
    await this.checkDirectory(path.join(process.cwd(), 'SOMA'), 'SOMA data directory');
    await this.checkDirectory(path.join(process.cwd(), 'SOMA', 'training-data'), 'Training data directory');
    await this.checkDirectory(path.join(process.cwd(), '.soma'), 'SOMA config directory');

    // 4. Critical files
    console.log('\n📄 Checking critical files...');
    await this.checkFile(path.join(process.cwd(), 'launcher_ULTRA.mjs'), 'Main launcher');
    await this.checkFile(path.join(process.cwd(), 'core', 'SomaBootstrapV2.js'), 'Bootstrap module');
    await this.checkFile(path.join(process.cwd(), 'arbiters', 'SOMArbiterV3.js'), 'Active cognitive engine');

    // 5. Environment (optional)
    console.log('\n🔐 Checking environment...');
    this.checkEnvVar('GEMINI_API_KEY', false);
    this.checkEnvVar('OPENAI_API_KEY', false);

    // Summary
    console.log('\n════════════════════════════════════════');
    console.log(`✅ Passed: ${this.passed.length}`);
    console.log(`⚠️  Warnings: ${this.warnings.length}`);
    console.log(`❌ Errors: ${this.errors.length}`);
    console.log('════════════════════════════════════════\n');

    if (this.errors.length > 0) {
      console.log('🛑 PRE-FLIGHT CHECK FAILED');
      console.log('Fix the errors above before starting SOMA.\n');
      return false;
    }

    console.log('✅ PRE-FLIGHT CHECK PASSED - Safe to launch!\n');
    return true;
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('PreFlightCheck.js')) {
  const checker = new PreFlightCheck();
  checker.runAll().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}

export default PreFlightCheck;
