import fs from 'fs';
import path from 'path';

const BANNED_DOMAINS_FILE = path.resolve(process.cwd(), 'data', 'aperture', 'banned_domains.json');

const DEFAULT_BANNED_DOMAINS = [
    // Phishing and domain scams
    "claim-tokens.xyz",
    "wallet-drainer.co",
    "freecrypto-airdrop.net",
    "metamask-login.support",
    "pancakeswap-airdrop.com",
    "uniswap-rewards.org",
    "ledger-security-verify.com",
    // Wildcard matches or bad suffixes
    "\\.xyz$",
    "\\.work$",
    "\\.win$",
    "drainer",
    "airdrop-claim"
];

const DEFAULT_BANNED_PHRASES = [
    "enter your private key to claim",
    "verify your seed phrase",
    "restore wallet recovery key",
    "connect wallet to claim free airdrop",
    "metamask support team private key",
    "send your crypto to double it",
    "guaranteed 100x return in 24 hours"
];

class DendriteSafetyFilter {
    constructor() {
        this.bannedDomains = [];
        this.bannedPhrases = [];
        this.init();
    }

    init() {
        try {
            fs.mkdirSync(path.dirname(BANNED_DOMAINS_FILE), { recursive: true });
            if (!fs.existsSync(BANNED_DOMAINS_FILE)) {
                const initial = {
                    bannedDomains: DEFAULT_BANNED_DOMAINS,
                    bannedPhrases: DEFAULT_BANNED_PHRASES
                };
                fs.writeFileSync(BANNED_DOMAINS_FILE, JSON.stringify(initial, null, 2), 'utf8');
            }
            this.load();
        } catch (err) {
            console.error('[DendriteSafetyFilter] Initialization failed:', err.message);
        }
    }

    load() {
        try {
            if (fs.existsSync(BANNED_DOMAINS_FILE)) {
                const config = JSON.parse(fs.readFileSync(BANNED_DOMAINS_FILE, 'utf8'));
                this.bannedDomains = Array.isArray(config.bannedDomains) ? config.bannedDomains : DEFAULT_BANNED_DOMAINS;
                this.bannedPhrases = Array.isArray(config.bannedPhrases) ? config.bannedPhrases : DEFAULT_BANNED_PHRASES;
            }
        } catch (err) {
            console.error('[DendriteSafetyFilter] Load failed:', err.message);
            this.bannedDomains = DEFAULT_BANNED_DOMAINS;
            this.bannedPhrases = DEFAULT_BANNED_PHRASES;
        }
    }

    isSafe(urlStr = '', contentStr = '') {
        const url = String(urlStr || '').trim().toLowerCase();
        const content = String(contentStr || '').trim().toLowerCase();

        if (!url) return false;

        // 1. Verify URL domain against banned list
        let hostname = '';
        try {
            hostname = new URL(url).hostname;
        } catch {
            hostname = url;
        }

        for (const pattern of this.bannedDomains) {
            try {
                // If it's a regex pattern or simple substring match
                const regex = new RegExp(pattern, 'i');
                if (regex.test(hostname)) {
                    console.warn(`[SafetyFilter] Blocked domain match: ${hostname} against pattern: ${pattern}`);
                    return false;
                }
            } catch {
                if (hostname.includes(pattern)) {
                    console.warn(`[SafetyFilter] Blocked domain substring: ${hostname} against pattern: ${pattern}`);
                    return false;
                }
            }
        }

        // 2. Verify page content text against banned phrases
        for (const phrase of this.bannedPhrases) {
            if (content.includes(phrase.toLowerCase())) {
                console.warn(`[SafetyFilter] Blocked content phrase match: "${phrase}" on URL: ${url}`);
                return false;
            }
        }

        return true;
    }

    sanitizeHTML(rawHtml = '') {
        if (!rawHtml) return '';
        return String(rawHtml)
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- [Dendrite: Malicious script stripped] -->')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '<!-- [Dendrite: Dangerous iframe stripped] -->')
            .replace(/on\w+="[^"]*"/gi, '')
            .replace(/on\w+='[^']*'/gi, '')
            .replace(/javascript:[^"']*/gi, '#dendrite-safe-link');
    }
}

const instance = new DendriteSafetyFilter();
export default instance;
export { DendriteSafetyFilter };
