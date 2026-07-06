import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const ROOT = process.cwd();
const STUDIO_DIR = path.join(ROOT, 'frontend', 'apps', 'studio');
const DIST_DIR = path.join(STUDIO_DIR, 'dist');
const DOMAIN = 'studio';
const GMN_PUBLISH_URL = 'http://127.0.0.1:3001/api/gmn/sites/publish';

async function run() {
    console.log(`[Studio Publisher] Building Vite app in ${STUDIO_DIR}...`);
    execSync('npm run build', { cwd: STUDIO_DIR, stdio: 'inherit' });

    console.log('[Studio Publisher] Zipping dist folder...');
    const zipPath = path.join(ROOT, 'studio.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    execSync(`powershell.exe -Command "Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${zipPath}' -Force"`);

    console.log(`[Studio Publisher] Publishing to http://127.0.0.1:3001/api/gmn/sites/import as ${DOMAIN}.gmn...`);
    const zipBase64 = fs.readFileSync(zipPath).toString('base64');

    try {
        const res = await fetch('http://127.0.0.1:3001/api/gmn/sites/import', {
            method: 'POST',
            body: JSON.stringify({ site: DOMAIN, zipBase64 }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();
        
        if (result.success) {
            console.log(`[Studio Publisher] ✅ Successfully published studio.gmn!`);
        } else {
            console.error(`[Studio Publisher] ❌ Failed to publish:`, result.error);
        }
    } catch (e) {
        console.error(`[Studio Publisher] ❌ Network error (is SOMA running?): ${e.message}`);
    }

    // Cleanup
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
}

run();
