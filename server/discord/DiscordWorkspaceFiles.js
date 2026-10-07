import fs from 'node:fs/promises';
import path from 'node:path';
import { isPastedCode } from '../../core/ExecutionProtocol.js';

export const DISCORD_TEXT_EXT = /\.(?:[cm]?js|jsx|tsx?|py|css|html?|md|txt)$/i;
const SEARCH_ROOTS = ['', 'arbiters', 'core', 'server', 'server/discord', 'server/finance', 'server/routes', 'server/services', 'server/loaders', 'scripts', 'models', 'shared', 'docs'];
const within = (root, target) => {
    const rel = path.relative(root, target);
    return Boolean(rel) && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

export function extractDiscordPaths(text = '') {
    const value = String(text);
    if (isPastedCode(value)) return [];
    const quoted = [...value.matchAll(/[`"']([^`"'\r\n]+\.(?:[cm]?js|jsx|tsx?|json|md|txt|py|css|html?))[`"']/gi)].map(match => match[1].trim());
    const unquoted = value.replace(/[`"'][^`"'\r\n]+[`"']/g, ' ');
    const bare = [...unquoted.matchAll(/(?:^|[\s(])((?:[A-Za-z]:)?[\w./\\-]+\.(?:[cm]?js|jsx|tsx?|json|md|txt|py|css|html?))\b(?!\s*\()/gi)].map(match => match[1]);
    return [...new Set([...quoted, ...bare])];
}

// Canonicalize both direct paths and basename matches. A path outside the repo,
// including a junction/symlink escape, must never become an engineering target.
export async function resolveDiscordWorkspaceFile(root, candidate) {
    const clean = String(candidate || '').trim();
    if (!clean || /[\x00\r\n*?]/.test(clean)) throw new Error('Name a specific workspace file.');
    const realRoot = await fs.realpath(root);
    const target = path.resolve(realRoot, clean);
    if (!within(realRoot, target)) throw new Error('File access is limited to the SOMA workspace.');
    // Validate existing ancestors even for a proposed new file below a junction.
    let ancestor = target;
    while (ancestor !== realRoot) {
        try {
            const real = await fs.realpath(ancestor);
            if (real !== realRoot && !within(realRoot, real)) throw new Error('File access is limited to the SOMA workspace.');
            break;
        } catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
            ancestor = path.dirname(ancestor);
        }
    }
    const matches = [];
    const add = async filename => {
        try {
            const real = await fs.realpath(filename);
            if (!within(realRoot, real)) throw new Error('File access is limited to the SOMA workspace.');
            if ((await fs.stat(real)).isFile() && !matches.includes(real)) matches.push(real);
        } catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
    };
    await add(target);
    if (!matches.length && !/[\\/]/.test(clean)) {
        for (const dir of SEARCH_ROOTS) {
            const entries = await fs.readdir(path.join(realRoot, dir), { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase() === clean.toLowerCase()) await add(path.join(realRoot, dir, entry.name));
            }
        }
    }
    if (matches.length > 1) throw new Error('More than one workspace file matches; specify its relative path.');
    return matches.length ? path.relative(realRoot, matches[0]).split(path.sep).join('/') : null;
}

export async function preflightDiscordEngineering({ root, request, filename = null }) {
    const candidates = [...new Set([filename, ...extractDiscordPaths(request)].filter(Boolean))];
    const modifiesExisting = /\b(?:update|modify|edit|patch|refactor|fix|repair|rewrite|remove|change|replace|delete|rename)\b/i.test(request);
    const createsNew = /\b(?:create|add|write|build|generate)\b/i.test(request);
    const resolvedPaths = [];
    for (const candidate of candidates) {
        const resolved = await resolveDiscordWorkspaceFile(root, candidate);
        if (!resolved && (modifiesExisting || !createsNew)) {
            return { ok: false, reply: `I couldn't locate \`${candidate}\` in the workspace root or source folders I checked. I haven't queued a job or changed anything. If that name came from my earlier reply, it wasn't verified. Give me its relative path, or ask me to locate the real implementation first.` };
        }
        resolvedPaths.push(resolved || candidate);
    }
    return { ok: true, paths: resolvedPaths };
}
