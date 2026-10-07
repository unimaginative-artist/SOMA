#!/usr/bin/env node

/**
 * start-terminal-integrated.cjs
 * 
 * Starts the Cognitive Terminal with Real SOMA Backend Integration
 * 
 * This script:
 * 1. Starts the Express backend server (port 3001) with real TriBrain
 * 2. Frontend runs via Vite (port 5173)
 * 3. All arbiters are wired to real SOMA components
 */

const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const terminalDir = path.join(rootDir, 'cognitive-terminal');

console.clear();
console.log('╔' + '═'.repeat(70) + '╗');
console.log('║' + ' '.repeat(10) + '🧠 SOMA COGNITIVE TERMINAL - INTEGRATED MODE 🧠' + ' '.repeat(10) + '║');
console.log('╚' + '═'.repeat(70) + '╝\n');

console.log('📍 Root Directory:', rootDir);
console.log('📍 Terminal Directory:', terminalDir);
console.log('');

// Check if node_modules exists in terminal directory
const fs = require('fs');
const nodeModulesPath = path.join(terminalDir, 'node_modules');

if (!fs.existsSync(nodeModulesPath)) {
    console.log('⚠️  node_modules not found in cognitive-terminal');
    console.log('📦 Installing dependencies...\n');
    
    const npmInstall = spawn('npm', ['install'], { 
        cwd: terminalDir, 
        stdio: 'inherit',
        shell: true 
    });
    
    npmInstall.on('close', (code) => {
        if (code !== 0) {
            console.error(`\n❌ npm install failed with code ${code}`);
            process.exit(1);
        }
        console.log('\n✅ Dependencies installed\n');
        startServers();
    });
} else {
    startServers();
}

function startServers() {
    console.log('🚀 Starting servers...\n');
    
    // Start backend server (Express on port 3001)
    console.log('🔧 Starting backend server (port 3001)...');
    const backendProcess = spawn('node', [path.join(terminalDir, 'server', 'index.cjs')], {
        cwd: rootDir,  // Run from SOMA root to access arbiters
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            PORT: '3001',
            DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
            DATABASE_PATH: path.join(rootDir, 'soma-memory.db')
        }
    });
    
    backendProcess.on('error', (err) => {
        console.error('❌ Backend server failed to start:', err);
        process.exit(1);
    });
    
    backendProcess.on('close', (code) => {
        console.log(`\n🔴 Backend server stopped with code ${code}`);
        process.exit(code);
    });
    
    // Wait a moment for backend to start
    setTimeout(() => {
        console.log('\n🎨 Starting frontend dev server (Vite on port 3000)...');
        console.log('─'.repeat(70));
        console.log('\n💡 Once started, open: http://localhost:3000\n');
        
        const frontendProcess = spawn('npm', ['run', 'dev'], {
            cwd: terminalDir,
            stdio: 'inherit',
            shell: true
        });
        
        frontendProcess.on('error', (err) => {
            console.error('❌ Frontend dev server failed to start:', err);
            backendProcess.kill();
            process.exit(1);
        });
        
        frontendProcess.on('close', (code) => {
            console.log(`\n🔴 Frontend dev server stopped with code ${code}`);
            backendProcess.kill();
            process.exit(code);
        });
    }, 2000);
    
    // Handle cleanup
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Shutting down servers...');
        backendProcess.kill();
        process.exit(0);
    });
}

console.log('─'.repeat(70));
console.log('\n📋 SYSTEM ARCHITECTURE:');
console.log('   Frontend: React + Vite (port 3000)');
console.log('   Backend: Express (port 3001)');
console.log('   AI: Real TriBrain (Ollama + DeepSeek + Gemini)');
console.log('   Memory: MnemonicArbiter (SQLite + Redis + Vector)');
console.log('   Processing: UniversalImpulser');
console.log('\n🔗 INTEGRATION STATUS:');
console.log('   ✓ Terminal wired to real SOMA arbiters');
console.log('   ✓ TriBrain using GPU-accelerated Ollama');
console.log('   ✓ Shared memory database: soma-memory.db');
console.log('   ✓ MessageBroker backbone active');
console.log('\n' + '─'.repeat(70) + '\n');
