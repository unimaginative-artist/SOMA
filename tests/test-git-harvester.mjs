import dotenv from 'dotenv';
import { GitHarvesterArbiter } from '../arbiters/GitHarvesterArbiter.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Mock global fetch to simulate GitHub API
const originalFetch = global.fetch;

global.fetch = async (url) => {
    console.log(`   [Mock Fetch] Intercepted URL: ${url}`);
    
    if (url.includes('/search/repositories')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                items: [
                    {
                        name: 'mock-utils-repo',
                        owner: { login: 'soma-dev' },
                        description: 'Mock repo for testing GitHarvesterArbiter',
                        html_url: 'https://github.com/soma-dev/mock-utils-repo',
                        stargazers_count: 999,
                        default_branch: 'main'
                    }
                ]
            })
        };
    }
    
    if (url.includes('/git/trees/')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                tree: [
                    { path: 'src/utils.js', type: 'blob' },
                    { path: 'test/utils.test.js', type: 'blob' },
                    { path: 'src/ignored.config.js', type: 'blob' }
                ]
            })
        };
    }
    
    if (url.includes('raw.githubusercontent.com')) {
        return {
            ok: true,
            status: 200,
            text: async () => `
// Raw mock helper code
function add(a, b) {
  return a + b;
}
function subtract(a, b) {
  return a - b;
}
module.exports = { add, subtract };
            `
        };
    }

    return { ok: false, status: 404 };
};

// Mock QuadBrain
const mockQuadBrain = {
    reason: async (prompt) => {
        return {
            text: `
Here is the clean self-contained code:
\`\`\`javascript
export function add(a, b) {
  return a + b;
}
export function subtract(a, b) {
  return a - b;
}
\`\`\`
            `
        };
    }
};

async function testGitHarvester() {
    console.log('🧪 Testing GitHarvesterArbiter...\n');

    const tempDir = path.join(process.cwd(), 'tests', 'temp-harvest');
    await fs.mkdir(tempDir, { recursive: true });

    try {
        const harvester = new GitHarvesterArbiter({
            rootPath: tempDir,
            quadBrain: mockQuadBrain
        });

        // Initialize
        console.log('1️⃣ Initializing GitHarvesterArbiter...');
        await harvester.initialize();
        console.log('✅ Initialized');

        // Test search
        console.log('\n2️⃣ Testing Repository Search...');
        const repos = await harvester.searchRepos('utilities', 1);
        console.log(`   Found repos: ${repos.length}`);
        if (repos.length === 0 || repos[0].name !== 'mock-utils-repo') {
            throw new Error('Search failed to return mock repository');
        }
        console.log('✅ Search passed');

        // Test crawl and harvest
        console.log('\n3️⃣ Testing Crawl and Harvest...');
        const harvested = await harvester.crawlAndHarvest('soma-dev', 'mock-utils-repo', 'main');
        console.log(`   Harvested files count: ${harvested.length}`);
        if (harvested.length === 0) {
            throw new Error('Crawl failed to harvest any utility files');
        }
        
        console.log('📊 Harvested Entry:');
        console.log(JSON.stringify(harvested[0], null, 2));

        // Verify catalog file
        console.log('\n4️⃣ Verifying Catalog entries...');
        const catalog = await harvester.getCatalog();
        console.log(`   Catalog contains ${catalog.length} items`);
        if (catalog.length === 0 || catalog[0].name !== 'mock-utils-repo-utils.js') {
            throw new Error('Catalog verification failed');
        }

        // Verify file written
        const fileContent = await fs.readFile(path.join(tempDir, 'harvested-libraries', 'mock-utils-repo-utils.js'), 'utf8');
        console.log(`\n📄 Harvested File Content:\n${fileContent}`);
        if (!fileContent.includes('export function add') || !fileContent.includes('subtract')) {
            throw new Error('Harvested file content is incorrect or not cleaned');
        }

        console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
        
        // Clean up
        await fs.rm(tempDir, { recursive: true, force: true });
        global.fetch = originalFetch; // restore
        process.exit(0);

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        global.fetch = originalFetch; // restore
        process.exit(1);
    }
}

testGitHarvester();
