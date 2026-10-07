#!/usr/bin/env node
// cluster-watchdog.cjs
// Health monitoring and auto-restart for SOMA cluster using WatchdogArbiter

const http = require('http');
const { spawn } = require('child_process');

class ClusterWatchdog {
  constructor(config = {}) {
    this.coordinatorUrl = config.coordinatorUrl || 'http://localhost:4200';
    this.checkInterval = config.checkInterval || 30000; // 30 seconds
    this.restartThreshold = config.restartThreshold || 3; // 3 consecutive failures
    this.coordinatorScript = config.coordinatorScript || '/Users/Eleven/Desktop/soma-dashboard/start-cluster-coordinator.cjs';
    
    this.failureCount = 0;
    this.lastHealthy = Date.now();
    this.isRestarting = false;
  }

  async checkHealth() {
    return new Promise((resolve) => {
      const url = `${this.coordinatorUrl}/health`;
      
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const health = JSON.parse(data);
            resolve({ healthy: res.statusCode === 200 && health.status === 'ok', data: health });
          } catch (e) {
            resolve({ healthy: false, error: 'Invalid response' });
          }
        });
      }).on('error', (e) => {
        resolve({ healthy: false, error: e.message });
      });
    });
  }

  async checkClusterStatus() {
    return new Promise((resolve) => {
      const url = `${this.coordinatorUrl}/cluster/nodes`;
      
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const nodes = JSON.parse(data);
            resolve({ success: true, nodes: nodes.count });
          } catch (e) {
            resolve({ success: false });
          }
        });
      }).on('error', () => {
        resolve({ success: false });
      });
    });
  }

  async restart() {
    if (this.isRestarting) {
      console.log('⏳ Already restarting...');
      return;
    }

    this.isRestarting = true;
    console.log('\n🔄 RESTARTING COORDINATOR...');
    
    // Kill existing coordinator
    try {
      const { execSync } = require('child_process');
      execSync('pkill -f start-cluster-coordinator');
      console.log('  ✓ Stopped old coordinator');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.log('  ℹ️  No existing coordinator to stop');
    }

    // Start new coordinator
    const child = spawn('node', [this.coordinatorScript], {
      detached: true,
      stdio: 'ignore',
      cwd: '/Users/Eleven/Desktop/soma-dashboard'
    });
    
    child.unref();
    
    console.log('  ✓ Started new coordinator');
    console.log('  ⏳ Waiting for startup...');
    
    // Wait for coordinator to be healthy
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const health = await this.checkHealth();
    if (health.healthy) {
      console.log('  ✅ Coordinator restarted successfully!');
      this.failureCount = 0;
      this.lastHealthy = Date.now();
    } else {
      console.log('  ⚠️  Coordinator may not be fully healthy yet');
    }
    
    this.isRestarting = false;
  }

  async monitor() {
    const health = await this.checkHealth();
    const cluster = await this.checkClusterStatus();
    
    const now = new Date().toISOString();
    
    if (health.healthy) {
      this.failureCount = 0;
      this.lastHealthy = Date.now();
      
      const uptimeMin = Math.floor((Date.now() - this.lastHealthy) / 60000);
      console.log(`[${now}] ✅ Healthy | Nodes: ${cluster.nodes || 0} | Uptime: ${uptimeMin}m`);
    } else {
      this.failureCount++;
      const downtime = Math.floor((Date.now() - this.lastHealthy) / 1000);
      
      console.log(`[${now}] ❌ Unhealthy (${this.failureCount}/${this.restartThreshold}) | Down: ${downtime}s | Error: ${health.error}`);
      
      if (this.failureCount >= this.restartThreshold) {
        console.log(`\n🚨 THRESHOLD REACHED: ${this.failureCount} consecutive failures`);
        await this.restart();
      }
    }
  }

  start() {
    console.log('🐕 SOMA Cluster Watchdog Starting...');
    console.log(`   Monitoring: ${this.coordinatorUrl}`);
    console.log(`   Check interval: ${this.checkInterval / 1000}s`);
    console.log(`   Restart threshold: ${this.restartThreshold} failures\n`);
    
    // Initial check
    this.monitor();
    
    // Periodic monitoring
    this.interval = setInterval(() => {
      this.monitor();
    }, this.checkInterval);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n👋 Watchdog shutting down...');
      clearInterval(this.interval);
      process.exit(0);
    });
  }
}

// Start watchdog
const watchdog = new ClusterWatchdog({
  coordinatorUrl: process.env.COORDINATOR_URL || 'http://localhost:4200',
  checkInterval: parseInt(process.env.CHECK_INTERVAL) || 30000,
  restartThreshold: parseInt(process.env.RESTART_THRESHOLD) || 3
});

watchdog.start();
