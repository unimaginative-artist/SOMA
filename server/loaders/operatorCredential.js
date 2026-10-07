import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultCredentialPath = path.join(projectRoot, '.soma', 'operator-token');

function credentialPath() {
    const configured = process.env.SOMA_OPERATOR_TOKEN_FILE?.trim();
    return configured ? path.resolve(configured) : defaultCredentialPath;
}

function readPersistedCredential(filePath) {
    try {
        const value = fs.readFileSync(filePath, 'utf8').trim();
        return value || null;
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`[OperatorCredential] Unable to read ${filePath}: ${error.message}`);
        }
        return null;
    }
}

/**
 * Resolve the dedicated human-operator credential. Environment configuration
 * wins; otherwise a strong local credential is provisioned in ignored runtime
 * state. Social-service passwords are deliberately never reused here.
 */
export function ensureOperatorCredential() {
    const configured = process.env.SOMA_OPERATOR_TOKEN?.trim()
        || process.env.SOMA_API_KEY?.trim();
    if (configured) return configured;

    const filePath = credentialPath();
    const persisted = readPersistedCredential(filePath);
    if (persisted) return persisted;

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const generated = `soma_op_${crypto.randomBytes(32).toString('base64url')}`;
        fs.writeFileSync(filePath, `${generated}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        console.info(`[OperatorCredential] Provisioned local operator credential at ${filePath}`);
        return generated;
    } catch (error) {
        if (error?.code === 'EEXIST') return readPersistedCredential(filePath);
        console.error(`[OperatorCredential] Unable to provision credential: ${error.message}`);
        return null;
    }
}

export function getOperatorCredentialPath() {
    return credentialPath();
}
