/**
 * core/CommandPolicyEngine.js
 * 
 * Security layer for SOMA Engineering Swarm.
 * Prevents execution of dangerous shell commands.
 */

export class CommandPolicyEngine {
    constructor() {
        this.allowed = [
            "node",
            "npm",
            "npx",
            "grep",
            "eslint",
            "tsc",
            "jest",
            "vitest",
            "cat",
            "ls",
            "dir",
            "cd",
            "mkdir",
            "findstr",
            "type",
            "git",
            "nvidia-smi",
            "ollama",
            "tasklist"
        ];
    }

    /**
     * Validate a command against the security policy.
     * @param {string} command The full command string to validate.
     * @returns {boolean} True if valid, throws error otherwise.
     */
    validate(command) {
        if (!command || typeof command !== 'string') {
            throw new Error("Invalid command format");
        }

        const base = command.trim().split(/\s+/)[0].toLowerCase();

        // Handle path-based commands (e.g. .\node_modules\.bin\tsc)
        const normalizedBase = base.split(/[\\\/]/).pop().replace(/\.exe$/, '').replace(/\.cmd$/, '').replace(/\.bat$/, '');

        if (!this.allowed.includes(normalizedBase)) {
            throw new Error(`Command blocked by security policy: ${command} (Base: ${normalizedBase})`);
        }

        // Dangerous pattern check
        const dangerousPatterns = [
            ">", ">>", "|", "&", ";", "rm ", "del ", "format ", "mkfs", "dd ", "chmod"
        ];

        // Allow some controlled piping for grep/findstr if needed, but for now strict
        for (const pattern of dangerousPatterns) {
            if (command.includes(pattern) && !this._isSafeException(command, pattern)) {
                throw new Error(`Command contains dangerous pattern '${pattern}': ${command}`);
            }
        }

        return true;
    }

    _isSafeException(command, pattern) {
        // Future: allow specific safe pipes like "npm test | grep ..."
        return false;
    }
}
