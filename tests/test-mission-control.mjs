#!/usr/bin/env node
/**
 * Mission Control Integration Test
 * Verifies that all Mission Control components and routes are properly wired
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('\n🎯 Mission Control Integration Test\n');
console.log('═'.repeat(60));

let testsPassed = 0;
let testsFailed = 0;

const test = (name, condition, details = '') => {
    if (condition) {
        console.log(`✅ ${name}`);
        if (details) console.log(`   ${details}`);
        testsPassed++;
    } else {
        console.log(`❌ ${name}`);
        if (details) console.log(`   ${details}`);
        testsFailed++;
    }
};

// Test 1: Frontend Component Files
console.log('\n📁 Frontend Component Files');
console.log('─'.repeat(60));

const frontendFiles = [
    'frontend/apps/command-bridge/components/MissionControl/MissionControlApp.jsx',
    'frontend/apps/command-bridge/components/MissionControl/constants.js',
    'frontend/apps/command-bridge/components/MissionControl/types.js',
    'frontend/apps/command-bridge/components/MissionControl/mission-control.css',
    'frontend/apps/command-bridge/components/MissionControl/components/GlobalControls.jsx',
    'frontend/apps/command-bridge/components/MissionControl/components/MainChart.jsx',
    'frontend/apps/command-bridge/components/MissionControl/components/MarketRadar.jsx',
    'frontend/apps/command-bridge/components/MissionControl/components/StrategyBrain.jsx',
];

frontendFiles.forEach(file => {
    const fullPath = join(rootDir, file);
    test(`${file}`, existsSync(fullPath));
});

// Test 2: Backend Files
console.log('\n📁 Backend Files');
console.log('─'.repeat(60));

const backendFiles = [
    'server/finance/scalpingRoutes.js',
    'server/finance/scalpingEngine.js',
    'server/finance/marketDataRoutes.js',
    'server/finance/marketDataService.js',
    'server/finance/lowLatencyRoutes.js',
];

backendFiles.forEach(file => {
    const fullPath = join(rootDir, file);
    test(`${file}`, existsSync(fullPath));
});

// Test 3: Main Component Import
console.log('\n🔌 Integration Wiring');
console.log('─'.repeat(60));

const checkFileContains = (file, searchString) => {
    try {
        const content = readFileSync(join(rootDir, file), 'utf-8');
        return content.includes(searchString);
    } catch (error) {
        return false;
    }
};

// Check SomaCommandBridge.jsx has Mission Control import
try {
    const bridgeContent = readFileSync(join(rootDir, 'frontend/apps/command-bridge/SomaCommandBridge.jsx'), 'utf-8');
    
    test(
        'MissionControlApp imported in SomaCommandBridge',
        bridgeContent.includes("import MissionControlApp from './panels/MissionControl/MissionControlApp'") ||
        bridgeContent.includes("import MissionControlApp from './components/MissionControl/MissionControlApp'"),
        'Mission Control module import found'
    );
    
    test(
        'Mission Control navigation item exists',
        bridgeContent.includes("{ id: 'mission_control', label: 'Mission Control'"),
        'Found in navigation array'
    );
    
    test(
        'Mission Control route rendering exists',
        bridgeContent.includes("activeModule === 'mission_control' && <MissionControlApp"),
        'Conditional render found'
    );
} catch (error) {
    test('SomaCommandBridge.jsx checks', false, `Error: ${error.message}`);
}

// Check route loader has Mission Control finance routes
try {
    const routesContent = readFileSync(join(rootDir, 'server/loaders/routes.js'), 'utf-8');
    
    test(
        'Scalping routes imported in route loader',
        routesContent.includes("import scalpingRoutes from '../../server/finance/scalpingRoutes.js'")
    );
    
    test(
        'Market data routes imported in route loader',
        routesContent.includes("import marketDataRoutes from '../../server/finance/marketDataRoutes.js'")
    );
    
    test(
        'Routes mounted correctly',
        routesContent.includes("safeMount('/api/scalping'") &&
        routesContent.includes("safeMount('/api/market'")
    );
} catch (error) {
    test('server/loaders/routes.js checks', false, `Error: ${error.message}`);
}

// Test 4: API Endpoints (if backend is running)
console.log('\n🌐 API Endpoints (if backend running)');
console.log('─'.repeat(60));

const testEndpoint = async (url, name) => {
    try {
        const response = await fetch(url, { timeout: 2000 });
        return { success: true, status: response.status };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

const endpoints = [
    { url: 'http://localhost:3001/api/scalping/stats', name: 'Scalping Stats' },
    { url: 'http://localhost:3001/api/market/bars/BTC-USD?timeframe=1Min&limit=10', name: 'Market Bars' },
];

for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint.url, endpoint.name);
    if (result.success) {
        test(
            `${endpoint.name} endpoint`,
            true,
            `Status: ${result.status}`
        );
    } else {
        test(
            `${endpoint.name} endpoint`,
            false,
            `Backend not running (${result.error})`
        );
    }
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 Test Summary');
console.log('═'.repeat(60));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

if (testsFailed === 0) {
    console.log('\n🎉 All tests passed! Mission Control is fully wired and ready.\n');
    process.exit(0);
} else {
    console.log('\n⚠️  Some tests failed. Review the errors above.\n');
    console.log('💡 If API endpoint tests failed, the backend may not be running.');
    console.log('   Start it with: npm run start:all\n');
    process.exit(testsFailed);
}
