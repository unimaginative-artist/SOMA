/**
 * NauticalParser.js
 * 
 * The Universal Translator for .:!<^> Notation.
 * Parses arbiter messages and validates tokens against the registry.
 */

export class NauticalParser {
    /**
     * @param {RegistryLoader} registryLoader 
     */
    constructor(registryLoader) {
        this.registry = registryLoader;
    }

    /**
     * Parse a single token
     */
    parse(token) {
        const entry = this.registry.lookup(token);
        if (!entry) return null;
        return {
            domain: entry.domain,
            operation: entry.operation,
            target: entry.target,
            modifier: entry.modifier,
            alias: entry.alias
        };
    }

    /**
     * Parse a full message line
     * Format: [SENDER]→[RECEIVER] token operand
     * Or: [ARBITER] token operand
     */
    parseLine(line) {
        const lineRegex = /^(\[(.*?)\])?(→)?(\[(.*?)\])?\s*([\/\\|])?\s*([.:!<^>~*]{2,5})\s*(.*)$/;
        const match = line.match(lineRegex);

        if (!match) return null;

        const [, , sender, , , receiver, epistemicPrefix, token, operand] = match;
        const parsedToken = this.parse(token);

        let epistemicState = 'UNCERTAIN';
        if (epistemicPrefix === '/') epistemicState = 'TRUE';
        if (epistemicPrefix === '\\') epistemicState = 'FALSE';

        return {
            from: sender || 'SYSTEM',
            to: receiver || null,
            epistemicState,
            token,
            parsed: parsedToken,
            operand: operand?.trim() || null
        };
    }

    /**
     * Parse a full session transcript
     */
    parseSession(text) {
        return text.split('\n')
            .map(line => this.parseLine(line.trim()))
            .filter(parsed => parsed !== null);
    }

    /**
     * Validate token against registry
     */
    validate(token) {
        const entry = this.registry.lookup(token);
        return {
            valid: !!entry,
            entry: entry || null
        };
    }
}
