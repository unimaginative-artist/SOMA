// ═══════════════════════════════════════════════════════════
// ResourceMonitor.js - Collect system resource stats
// CPU, RAM, GPU, Disk, Network metrics
// ═══════════════════════════════════════════════════════════

import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ResourceMonitor {
  constructor(config = {}) {
    this.name = config.name || 'ResourceMonitor';
    this.updateInterval = config.updateInterval || 5000;
    
    // Cached stats
    this.lastStats = null;
    this.lastCPUInfo = this.getCPUInfo();
    
    console.log(`📊 [${this.name}] Resource monitor initialized`);
  }

  // ═══════════════════════════════════════════════════════════
  // CPU MONITORING
  // ═══════════════════════════════════════════════════════════

  getCPUInfo() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    return { idle: totalIdle, total: totalTick };
  }

  getCPUUsage() {
    const currentCPU = this.getCPUInfo();
    const idleDiff = currentCPU.idle - this.lastCPUInfo.idle;
    const totalDiff = currentCPU.total - this.lastCPUInfo.total;
    
    this.lastCPUInfo = currentCPU;
    
    const usage = 100 - Math.floor(100 * idleDiff / totalDiff);
    return Math.max(0, Math.min(100, usage));
  }

  // ═══════════════════════════════════════════════════════════
  // MEMORY MONITORING
  // ═══════════════════════════════════════════════════════════

  getMemoryStats() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    
    return {
      total: total,
      free: free,
      used: used,
      usedPercent: Math.round((used / total) * 100),
      totalGB: (total / 1024**3).toFixed(2),
      freeGB: (free / 1024**3).toFixed(2),
      usedGB: (used / 1024**3).toFixed(2)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // GPU DETECTION
  // ═══════════════════════════════════════════════════════════

  async detectGPU() {
    const platform = os.platform();
    let gpu = {
      available: false,
      type: 'None',
      vendor: 'Unknown',
      memory: 0,
      utilization: 0
    };

    try {
      if (platform === 'darwin') {
        // macOS - Check for Apple Silicon or AMD
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType');
        
        if (stdout.includes('Apple')) {
          gpu.available = true;
          gpu.type = 'Apple Silicon (Metal)';
          gpu.vendor = 'Apple';
          
          // Extract VRAM if available
          const vramMatch = stdout.match(/VRAM.*?(\d+)\s*(MB|GB)/);
          if (vramMatch) {
            gpu.memory = vramMatch[2] === 'GB' 
              ? parseInt(vramMatch[1]) * 1024 
              : parseInt(vramMatch[1]);
          }
        } else if (stdout.includes('AMD') || stdout.includes('Radeon')) {
          gpu.available = true;
          gpu.type = 'AMD';
          gpu.vendor = 'AMD';
        }
      } else if (platform === 'linux') {
        // Linux - Check for NVIDIA CUDA
        try {
          const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total,utilization.gpu --format=csv,noheader,nounits');
          const [name, memory, util] = stdout.trim().split(',');
          
          gpu.available = true;
          gpu.type = name.trim();
          gpu.vendor = 'NVIDIA';
          gpu.memory = parseInt(memory);
          gpu.utilization = parseInt(util);
        } catch (e) {
          // No NVIDIA GPU
        }
      } else if (platform === 'win32') {
        // Windows - Check WMIC
        try {
          const { stdout } = await execAsync('wmic path win32_VideoController get name');
          gpu.type = stdout.split('\n')[1].trim();
          gpu.available = true;
        } catch (e) {
          // GPU detection failed
        }
      }
    } catch (error) {
      // GPU detection failed, keep defaults
    }

    return gpu;
  }

  // ═══════════════════════════════════════════════════════════
  // DISK STATS
  // ═══════════════════════════════════════════════════════════

  async getDiskStats() {
    const platform = os.platform();
    let disk = {
      total: 0,
      used: 0,
      free: 0,
      usedPercent: 0
    };

    try {
      if (platform === 'darwin' || platform === 'linux') {
        const { stdout } = await execAsync('df -k / | tail -1');
        const parts = stdout.trim().split(/\s+/);
        
        disk.total = parseInt(parts[1]) * 1024; // KB to bytes
        disk.used = parseInt(parts[2]) * 1024;
        disk.free = parseInt(parts[3]) * 1024;
        disk.usedPercent = parseInt(parts[4]);
      } else if (platform === 'win32') {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
        // Parse Windows output
        const lines = stdout.trim().split('\n').slice(1);
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          disk.free = parseInt(parts[1]);
          disk.total = parseInt(parts[2]);
          disk.used = disk.total - disk.free;
          disk.usedPercent = Math.round((disk.used / disk.total) * 100);
        }
      }
    } catch (error) {
      // Disk stats unavailable
    }

    return disk;
  }

  // ═══════════════════════════════════════════════════════════
  // NETWORK STATS
  // ═══════════════════════════════════════════════════════════

  async getNetworkStats() {
    // Basic network info
    const interfaces = os.networkInterfaces();
    const activeInterfaces = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      const ipv4 = addrs.find(addr => addr.family === 'IPv4' && !addr.internal);
      if (ipv4) {
        activeInterfaces.push({
          name,
          address: ipv4.address,
          mac: ipv4.mac
        });
      }
    }

    return {
      interfaces: activeInterfaces,
      hostname: os.hostname()
    };
  }

  // ═══════════════════════════════════════════════════════════
  // COLLECT ALL STATS
  // ═══════════════════════════════════════════════════════════

  async collectStats() {
    const stats = {
      timestamp: Date.now(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      
      cpu: {
        usage: this.getCPUUsage(),
        cores: os.cpus().length,
        model: os.cpus()[0].model,
        speed: os.cpus()[0].speed
      },
      
      memory: this.getMemoryStats(),
      
      loadAvg: os.loadavg(),
      
      network: await this.getNetworkStats()
    };

    // GPU detection (cached for 30s to avoid repeated checks)
    if (!this.lastStats || Date.now() - this.lastStats.timestamp > 30000) {
      stats.gpu = await this.detectGPU();
    } else {
      stats.gpu = this.lastStats.gpu;
    }

    // Disk stats (less frequent)
    if (!this.lastStats || Date.now() - this.lastStats.timestamp > 10000) {
      stats.disk = await this.getDiskStats();
    } else {
      stats.disk = this.lastStats.disk;
    }

    this.lastStats = stats;
    return stats;
  }

  // ═══════════════════════════════════════════════════════════
  // START MONITORING
  // ═══════════════════════════════════════════════════════════

  startMonitoring(callback) {
    console.log(`🔄 [${this.name}] Starting resource monitoring (${this.updateInterval}ms interval)`);
    
    // Initial collection
    this.collectStats().then(callback);
    
    // Regular updates
    this.monitorInterval = setInterval(async () => {
      const stats = await this.collectStats();
      callback(stats);
    }, this.updateInterval);
  }

  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      console.log(`⏹️  [${this.name}] Resource monitoring stopped`);
    }
  }
}

export default ResourceMonitor;
