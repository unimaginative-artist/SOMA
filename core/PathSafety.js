import path from 'path';
import { getAllowedRootForTier, BRAIN_TIER } from './BrainAuthorityPolicy.js';

const SOMA_ROOT = path.resolve(process.cwd());
const STACK_ROOT = path.resolve(SOMA_ROOT, '..');

// System critical folders that can never be touched regardless of model
const FORBIDDEN_SUBSTRINGS = [
    '\\windows\\',
    '/windows/',
    '\\system32\\',
    '/system32/',
    '\\program files\\',
    '/program files/',
    '\\program files (x86)\\',
    '/program files (x86)/'
];

/**
 * Resolve path safely within the authorized root.
 * 
 * @param {string} rootPath - Base root path (usually process.cwd())
 * @param {string} candidatePath - Target file/directory path
 * @param {string} [label='Path'] - Error label
 * @param {Object} [options={}]
 * @param {boolean} [options.allowRoot=false] - Whether exact root path is allowed
 * @param {'frontier' | 'local'} [options.authorityTier] - Active brain tier
 * @returns {string} Fully resolved safe absolute path
 */
export function resolveWithinRoot(rootPath, candidatePath, label = 'Path', { allowRoot = false, authorityTier } = {}) {
    // rootPath is a capability supplied by trusted application code, not a model
    // argument. Internal Git worktrees/tests must resolve relative to that root.
    // Model-facing callers can additionally apply an explicit brain-tier policy.
    const baseRoot = path.resolve(rootPath || SOMA_ROOT);
    const activeRoot = authorityTier === BRAIN_TIER.FRONTIER
        ? getAllowedRootForTier(BRAIN_TIER.FRONTIER)
        : baseRoot;

    // If candidate path is relative, resolve against SOMA_ROOT first, else resolve candidate
    const resolved = path.isAbsolute(candidatePath)
        ? path.resolve(candidatePath)
        : path.resolve(baseRoot, candidatePath);

    // 1. HARD HOST BOUNDARY: Never permit escaping "The Stack"
    const relativeToStack = path.relative(STACK_ROOT, resolved);
    if (authorityTier !== undefined && (relativeToStack.startsWith('..') || path.isAbsolute(relativeToStack))) {
        throw new Error(`${label} violates hard host boundary (outside The Stack): ${candidatePath}`);
    }
    if (authorityTier !== undefined && authorityTier !== BRAIN_TIER.FRONTIER) {
        const relativeToSoma = path.relative(SOMA_ROOT, resolved);
        if (relativeToSoma.startsWith('..') || path.isAbsolute(relativeToSoma)) {
            throw new Error(`${label} outside allowed root for local brain: ${candidatePath}`);
        }
    }

    // 2. HARD OS BOUNDARY: Explicit check against Windows system folders
    const normalizedLower = resolved.toLowerCase();
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        if (normalizedLower.includes(forbidden)) {
            throw new Error(`${label} violates system safety policy (forbidden OS directory): ${candidatePath}`);
        }
    }

    // 3. TIER BOUNDARY: If local tier, must be within activeRoot (SOMA_ROOT)
    const relativeToActive = path.relative(activeRoot, resolved);
    if ((!allowRoot && relativeToActive === '') || relativeToActive.startsWith('..') || path.isAbsolute(relativeToActive)) {
        throw new Error(`${label} outside allowed root (${activeRoot}): ${candidatePath}`);
    }

    return resolved;
}

export function isWithinRoot(rootPath, candidatePath, options = {}) {
    try {
        resolveWithinRoot(rootPath, candidatePath, 'Check', options);
        return true;
    } catch {
        return false;
    }
}

export default {
    resolveWithinRoot,
    isWithinRoot
};
