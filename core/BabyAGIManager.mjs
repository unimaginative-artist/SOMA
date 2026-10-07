// core/BabyAGIManager.mjs
// Manages the lifecycle of the BabyCommandAGI Docker container

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';

const __dirname = join(process.cwd());
const babyAgiDir = join(__dirname, 'BabyCommandAGI');

export class BabyAGIManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.process = null;
    this.dockerComposeUp = null;
  }

  async start(objective, llmModel) {
    if (this.process) {
      this.emit('error', 'BabyAGI is already running.');
      return;
    }

    this.emit('status', 'starting');

    try {
      // 1. Create .env file
      const envContent = [
        `LLM_MODEL="${llmModel}"`, 
        `OBJECTIVE="${objective}"`, 
        `INITIAL_TASK=Develop a task list`,
        `ANTHROPIC_API_KEY=${this.config.apiKeys.anthropic || ''}`, 
        `OPENAI_API_KEY=${this.config.apiKeys.openai || ''}`, 
        `GOOGLE_AI_STUDIO_API_KEY=${this.config.apiKeys.gemini || ''}`
      ].join('\n');
      
      const envPath = join(babyAgiDir, '.env');
      await writeFile(envPath, envContent);
      this.emit('data', '[SOMA] .env file created for BabyAGI.\n');

      // 2. Run docker-compose up -d
      this.emit('data', '[SOMA] Starting BabyAGI container...\n');
      this.dockerComposeUp = spawn('docker-compose', ['up', '-d', '--build'], { cwd: babyAgiDir, stdio: 'pipe' });

      this.dockerComposeUp.stdout.on('data', (data) => this.emit('data', `[DOCKER] ${data.toString()}`));
      this.dockerComposeUp.stderr.on('data', (data) => this.emit('data', `[DOCKER ERR] ${data.toString()}`));

      await new Promise((resolve, reject) => {
        this.dockerComposeUp.on('close', (code) => {
          if (code === 0) {
            this.emit('data', '[SOMA] BabyAGI container started.\n');
            resolve();
          } else {
            reject(new Error(`docker-compose up failed with code ${code}`));
          }
        });
      });

      // 3. Attach to the container
      this.emit('data', '[SOMA] Attaching to BabyAGI process...\n');
      this.process = spawn('docker', ['attach', 'babyagi'], { cwd: babyAgiDir, stdio: ['pipe', 'pipe', 'pipe'] });

      this.process.stdout.on('data', (data) => {
        this.emit('data', data.toString());
      });

      this.process.stderr.on('data', (data) => {
        this.emit('error', data.toString());
      });

      this.process.on('close', async (code) => {
        this.emit('status', 'stopped');
        this.emit('data', `\n[SOMA] BabyAGI process exited with code ${code}.\n`);
        this.process = null;
        // Clean up .env file
        try {
          await unlink(envPath);
          this.emit('data', '[SOMA] Cleaned up .env file.\n');
        } catch (err) {
          // ignore
        }
      });

      this.emit('status', 'running');

    } catch (error) {
      this.emit('error', `Failed to start BabyAGI: ${error.message}`);
      this.emit('status', 'stopped');
    }
  }

  async stop() {
    if (!this.process) {
      this.emit('error', 'BabyAGI is not running.');
      // Still try to stop the container in case it's running detached
    }

    this.emit('status', 'stopping');
    this.emit('data', '\n[SOMA] Stopping BabyAGI container...\n');
    
    // Detach from the process if it's running
    if(this.process){
        this.process.kill('SIGINT');
    }


    const stopProcess = spawn('docker-compose', ['stop'], { cwd: babyAgiDir });
    
    await new Promise((resolve) => {
        stopProcess.on('close', () => {
            this.emit('data', '[SOMA] BabyAGI container stopped.\n');
            this.emit('status', 'stopped');
            this.process = null;
            resolve();
        });
    });
  }

  send(data) {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(data + '\n');
      this.emit('data', `\n[INPUT] ${data}\n`);
    } else {
      this.emit('error', 'BabyAGI is not running or stdin is not available.');
    }
  }
}
