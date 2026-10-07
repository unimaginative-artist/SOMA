import dotenv from 'dotenv';
import { MockHarnessGenerator } from '../core/MockHarnessGenerator.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

dotenv.config();

const originalCwd = process.cwd;
const tempDir = path.join(originalCwd(), 'tests', 'temp-mock-sandbox');
process.cwd = () => tempDir;

async function runTest() {
    console.log('🧪 Starting Dynamic Mock & Harness Generator (Phase 14) Verification Test...\n');

    try {
        // Prepare sandboxed dirs
        await fs.mkdir(tempDir, { recursive: true });
        
        // Write mock package.json
        const mockPkgJson = {
            name: 'mock-soma-app',
            dependencies: {
                // Let's pretend express is already installed, so it won't be mocked
                'express': '^4.18.2'
            }
        };
        await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(mockPkgJson, null, 2), 'utf8');

        const generator = new MockHarnessGenerator({
            rootPath: tempDir
        });

        const testLibraryCode = `
            import lodash from 'lodash';
            import { get, post } from 'axios';
            import { format } from 'date-fns';
            import express from 'express'; // Declared in package.json, should be skipped
            import fs from 'fs'; // Node builtin, should be skipped
            import { localHelper } from './local-helper.js'; // Relative path, should be skipped

            export function doWork() {
                const data = lodash.map([1, 2], x => x * 2);
                return axios.get('/api').then(res => res.data);
            }
        `;

        console.log('1️⃣ Running processLibrary to generate mocks for missing dependencies...');
        await generator.processLibrary('src/mock-utility.js', testLibraryCode);

        // Define expected mock paths
        const nodeModulesPath = path.join(tempDir, 'node_modules');
        const axiosPath = path.join(nodeModulesPath, 'axios');
        const lodashPath = path.join(nodeModulesPath, 'lodash');
        const dateFnsPath = path.join(nodeModulesPath, 'date-fns');
        const expressPath = path.join(nodeModulesPath, 'express');

        console.log('\n2️⃣ Verifying generated mock folders and files...');
        
        // Assertions
        if (!existsSync(axiosPath)) throw new Error('axios mock folder was not created');
        if (!existsSync(lodashPath)) throw new Error('lodash mock folder was not created');
        if (!existsSync(dateFnsPath)) throw new Error('date-fns mock folder was not created');
        if (existsSync(expressPath)) throw new Error('express mock folder was created but it should be skipped (declared in package.json)');

        console.log('✅ Correct folders created/skipped');

        // Check axios index content
        const axiosIndexContent = await fs.readFile(path.join(axiosPath, 'index.js'), 'utf8');
        console.log(`\n📄 axios Mock Content:\n${axiosIndexContent}`);

        if (!axiosIndexContent.includes('export const get = mockProxy;')) {
            throw new Error('axios Mock index does not export named variable: get');
        }
        if (!axiosIndexContent.includes('export const post = mockProxy;')) {
            throw new Error('axios Mock index does not export named variable: post');
        }
        console.log('✅ Static named exports written correctly');

        // Verify mock registry
        const registryFile = path.join(tempDir, 'data', 'mocks', 'registry.json');
        if (!existsSync(registryFile)) throw new Error('Mock registry file was not created');
        const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
        console.log(`\n📄 Mock Registry Content:\n${JSON.stringify(registry, null, 2)}`);
        
        if (!registry.axios || !registry.lodash || !registry['date-fns']) {
            throw new Error('Registry is missing registered mocks');
        }
        console.log('✅ Mock registry verification passed');

        console.log('\n3️⃣ Loading mock modules dynamically to verify execution & thenable/iterable safety...');

        // Import the mock stubs using absolute file URLs so ESM handles them correctly on Windows
        const axiosUrl = `file:///${path.join(axiosPath, 'index.js').replace(/\\/g, '/')}`;
        const lodashUrl = `file:///${path.join(lodashPath, 'index.js').replace(/\\/g, '/')}`;

        console.log(`   Importing axios from: ${axiosUrl}`);
        const axiosMock = await import(axiosUrl);
        console.log(`   Importing lodash from: ${lodashUrl}`);
        const lodashMock = await import(lodashUrl);

        // Test proxy properties
        const defaultAxios = axiosMock.default;
        const axiosGet = axiosMock.get;

        if (typeof defaultAxios !== 'function' || typeof axiosGet !== 'function') {
            throw new Error('Mock exports are not functions');
        }

        // Test bulletproof thenable behavior (async/await safety)
        console.log('   Testing async/await safety...');
        const resultPromise = axiosGet('/api');
        const awaitedResult = await resultPromise;
        if (typeof awaitedResult !== 'function') {
            throw new Error('Awaited result of mock method is not the proxy');
        }
        console.log('   ✅ Await completed immediately without hanging');

        // Test iterator safety
        console.log('   Testing iterator safety...');
        let iteratedCount = 0;
        for (const item of awaitedResult) {
            iteratedCount++;
        }
        if (iteratedCount !== 0) {
            throw new Error('Iteration on mock did not yield an empty collection');
        }
        console.log('   ✅ Spread/iteration evaluated successfully over empty iterator');

        // Test JSON serialization safety
        console.log('   Testing JSON serialization safety...');
        const serialized = JSON.stringify(awaitedResult);
        if (serialized !== '{}') {
            throw new Error('JSON serialization did not produce empty object');
        }
        console.log('   ✅ JSON serialization completed safely');

        console.log('\n🎉 ALL PHASE 14 TESTS PASSED YAY!');
        
        // Cleanup CWD override and temp directory
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true });
        process.exit(0);

    } catch (error) {
        console.error('\n❌ TEST SUITE FAILED:', error.message);
        console.error(error.stack);
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        process.exit(1);
    }
}

runTest();
