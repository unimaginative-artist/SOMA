/**
 * SecureLogger.cjs - Logging with Automatic Sensitive Data Redaction (CommonJS)
 *
 * CRITICAL SECURITY: Prevents API keys, passwords, tokens from appearing in logs
 *
 * Based on: librechat_repo/api/utils/LoggingSystem.js
 * Integrated: January 15, 2026
 */

// ═══════════════════════════════════════════════════════════════════
// REDACTION PATTERNS
// ═══════════════════════════════════════════════════════════════════

const REDACTION_PATTERNS = [
  /api[-_]?key/i,
  /password/i,
  /token/i,
  /secret/i,
  /private[-_]?key/i,
  /access[-_]?key/i,
  /auth[-_]?token/i,
  /bearer/i,
  /certificate/i,
  /credential/i,
  /session[-_]?id/i,
  /cookie/i,
  /apikey/i,
];

const REDACTED_VALUE = '***REDACTED***';

// ═══════════════════════════════════════════════════════════════════
// REDACTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function shouldRedact(key) {
  if (typeof key !== 'string') return false;
  return REDACTION_PATTERNS.some(pattern => pattern.test(key));
}

function redactSensitiveData(obj, depth = 0) {
  if (depth > 10) return obj;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedact(key)) {
      redacted[key] = REDACTED_VALUE;
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function redactArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(arg)) {
      return REDACTED_VALUE;
    }
    if (typeof arg === 'object' && arg !== null) {
      return redactSensitiveData(arg);
    }
    return arg;
  });
}

// ═══════════════════════════════════════════════════════════════════
// LOGGER CLASS
// ═══════════════════════════════════════════════════════════════════

class SecureLogger {
  constructor(options = {}) {
    this.enableRedaction = options.enableRedaction !== false;
    this.logLevel = options.logLevel || 'info';
    this.enableTimestamps = options.enableTimestamps !== false;
    this.enableColors = options.enableColors !== false;

    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };

    this.colors = {
      reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
      yellow: '\x1b[33m', blue: '\x1b[34m', gray: '\x1b[90m'
    };
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  isLevelEnabled(level) {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  formatMessage(level) {
    const parts = [];
    if (this.enableTimestamps) {
      const ts = this.enableColors
        ? `${this.colors.gray}${this.getTimestamp()}${this.colors.reset}`
        : this.getTimestamp();
      parts.push(`[${ts}]`);
    }

    if (this.enableColors) {
      const levelColors = {
        debug: this.colors.blue, info: this.colors.green,
        warn: this.colors.yellow, error: this.colors.red
      };
      parts.push(`${levelColors[level]}[${level.toUpperCase()}]${this.colors.reset}`);
    } else {
      parts.push(`[${level.toUpperCase()}]`);
    }
    return parts;
  }

  log(level, ...args) {
    if (!this.isLevelEnabled(level)) return;
    const safeArgs = this.enableRedaction ? redactArgs(args) : args;
    const formatted = this.formatMessage(level);
    console[level === 'debug' ? 'log' : level](...formatted, ...safeArgs);
  }

  debug(...args) { this.log('debug', ...args); }
  info(...args) { this.log('info', ...args); }
  warn(...args) { this.log('warn', ...args); }
  error(...args) { this.log('error', ...args); }

  unsafe(...args) {
    const orig = this.enableRedaction;
    this.enableRedaction = false;
    this.info(...args);
    this.enableRedaction = orig;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT INSTANCE & EXPORT
// ═══════════════════════════════════════════════════════════════════

const logger = new SecureLogger({
  enableRedaction: true,
  logLevel: process.env.LOG_LEVEL || 'info',
  enableTimestamps: true,
  enableColors: true
});

module.exports = logger;
module.exports.SecureLogger = SecureLogger;
module.exports.logger = logger;
module.exports.default = logger;
