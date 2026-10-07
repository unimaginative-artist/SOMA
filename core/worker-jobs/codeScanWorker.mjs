import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'llama.cpp', 'vendor']);

async function walk(dir, out, limit) {
    if (out.length >= limit) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (out.length >= limit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) await walk(full, out, limit);
        } else if (/\.(js|cjs|mjs|ts|tsx|jsx)$/i.test(entry.name)) {
            const content = await fs.readFile(full, 'utf8').catch(() => '');
            out.push({
                path: path.relative(ROOT, full).replace(/\\/g, '/'),
                lines: content ? content.split(/\r?\n/).length : 0,
                todos: (content.match(/\bTODO\b|FIXME|stub|simulate|placeholder/gi) || []).length,
                exports: (content.match(/\bexport\b/g) || []).length
            });
        }
    }
}

export async function processItem(item = {}) {
    const target = path.resolve(ROOT, item.dir || item.path || '.');
    if (!target.startsWith(ROOT)) throw new Error('codeScanWorker target outside workspace');
    const files = [];
    await walk(target, files, item.limit || 500);
    return {
        scannedAt: new Date().toISOString(),
        root: path.relative(ROOT, target).replace(/\\/g, '/') || '.',
        files,
        totals: {
            files: files.length,
            todos: files.reduce((sum, file) => sum + file.todos, 0),
            lines: files.reduce((sum, file) => sum + file.lines, 0)
        }
    };
}

export default processItem;
