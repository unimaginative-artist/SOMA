// Test ResourceMonitor
import { ResourceMonitor } from '../cluster/ResourceMonitor.js';

async function test() {
  console.log('🧪 Testing ResourceMonitor...\n');
  
  const monitor = new ResourceMonitor({
    name: 'TestMonitor',
    updateInterval: 2000
  });
  
  // Collect stats once
  console.log('📊 Collecting stats...\n');
  const stats = await monitor.collectStats();
  
  console.log('=== SYSTEM INFO ===');
  console.log(`Hostname: ${stats.hostname}`);
  console.log(`Platform: ${stats.platform} (${stats.arch})`);
  console.log(`Uptime: ${Math.floor(stats.uptime / 3600)}h\n`);
  
  console.log('=== CPU ===');
  console.log(`Model: ${stats.cpu.model}`);
  console.log(`Cores: ${stats.cpu.cores}`);
  console.log(`Speed: ${stats.cpu.speed} MHz`);
  console.log(`Usage: ${stats.cpu.usage}%\n`);
  
  console.log('=== MEMORY ===');
  console.log(`Total: ${stats.memory.totalGB} GB`);
  console.log(`Used: ${stats.memory.usedGB} GB (${stats.memory.usedPercent}%)`);
  console.log(`Free: ${stats.memory.freeGB} GB\n`);
  
  console.log('=== GPU ===');
  console.log(`Available: ${stats.gpu.available}`);
  console.log(`Type: ${stats.gpu.type}`);
  console.log(`Vendor: ${stats.gpu.vendor}`);
  if (stats.gpu.memory > 0) {
    console.log(`VRAM: ${stats.gpu.memory} MB`);
  }
  console.log();
  
  console.log('=== DISK ===');
  console.log(`Total: ${(stats.disk.total / 1024**3).toFixed(2)} GB`);
  console.log(`Used: ${(stats.disk.used / 1024**3).toFixed(2)} GB (${stats.disk.usedPercent}%)`);
  console.log(`Free: ${(stats.disk.free / 1024**3).toFixed(2)} GB\n`);
  
  console.log('=== NETWORK ===');
  stats.network.interfaces.forEach(iface => {
    console.log(`${iface.name}: ${iface.address}`);
  });
  console.log();
  
  // Test continuous monitoring
  console.log('🔄 Starting continuous monitoring (5 updates)...\n');
  let count = 0;
  
  monitor.startMonitoring((stats) => {
    count++;
    console.log(`[${count}] CPU: ${stats.cpu.usage}% | RAM: ${stats.memory.usedPercent}% | Load: ${stats.loadAvg[0].toFixed(2)}`);
    
    if (count >= 5) {
      monitor.stopMonitoring();
      console.log('\n✅ Resource monitor test complete!');
      process.exit(0);
    }
  });
}

test().catch(console.error);
