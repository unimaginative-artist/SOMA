/**
 * NauticalEncoder — generates Nautical Notation strings from structured data
 * Pair with NauticalParser: encoder writes, parser reads.
 */

import { RegistryLoader } from './RegistryLoader.js';
import path               from 'path';
import { fileURLToPath }  from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../registry/registry.json');

export class NauticalEncoder {
    constructor(registryPath = REGISTRY_PATH) {
        this.registry = new RegistryLoader();
        try { this.registry.load(registryPath); } catch { /* non-fatal */ }
    }

    /**
     * Encode a protocol header line
     * @param {object} opts
     * @param {string} opts.version
     * @param {string} opts.arbiter
     * @param {string} opts.voyageId
     * @returns {string}
     */
    header({ version = '0.1', arbiter, voyageId }) {
        const count = this.registry.all().length || 17;
        return `POSEIDON::${version} REGISTRY::${count} ARBITER::${arbiter} VOYAGE::${voyageId}`;
    }

    /**
     * Encode a single message line
     * @param {object} opts
     * @param {string} opts.from        - sending arbiter name
     * @param {string} [opts.to]        - receiving arbiter name
     * @param {string} [opts.state]     - epistemic state: / \ |
     * @param {string} opts.token       - Nautical token (e.g. '!:.')
     * @param {string} [opts.operand]   - operand/argument
     * @returns {string}
     */
    message({ from, to, state, token, operand }) {
        const parts = [];

        // Arbiter address
        if (from && to)  parts.push(`[${from}]→[${to}]`);
        else if (from)   parts.push(`[${from}]`);

        // Epistemic state
        if (state) parts.push(state);

        // Token
        if (token) parts.push(token);

        // Operand
        if (operand) parts.push(operand);

        return parts.join(' ');
    }

    /**
     * Encode a message using an alias instead of raw token
     * @param {object} opts - same as message() but with alias instead of token
     */
    messageByAlias({ from, to, state, alias, operand }) {
        const entry = this.registry.lookupAlias(alias);
        const token = entry?.token || alias;
        return this.message({ from, to, state, token, operand });
    }

    /**
     * Encode a full session transcript
     * @param {object} session
     * @param {object} session.header   - { version, arbiter, voyageId }
     * @param {Array}  session.messages - array of message objects
     * @returns {string}
     */
    session({ header, messages = [] }) {
        const lines = [];
        if (header) lines.push(this.header(header));
        lines.push('');
        for (const msg of messages) {
            lines.push(this.message(msg));
        }
        return lines.join('\n');
    }

    /**
     * Encode a voyage contextDump as a Nautical header comment
     * @param {string} contextDump - output of odyssey.contextDump()
     * @param {string} arbiter
     * @returns {string}
     */
    sessionStart(contextDump, arbiter) {
        const voyageMatch = contextDump.match(/^VOYAGE:(\S+)/);
        const voyageId    = voyageMatch ? voyageMatch[1] : 'unknown';
        return [
            this.header({ arbiter, voyageId }),
            `// ${contextDump}`,
            '',
        ].join('\n');
    }
}
