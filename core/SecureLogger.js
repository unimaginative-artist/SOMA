/**
 * SecureLogger.js - Logging with Automatic Sensitive Data Redaction
 *
 * CRITICAL SECURITY: Prevents API keys, passwords, tokens from appearing in logs
 *
 * Based on: librechat_repo/api/utils/LoggingSystem.js
 * Integrated: January 15, 2026
 */

// ═══════════════════════════════════════════════════════════════════
// REDACTION PATTERNS - Add more as needed
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

/**
 * Check if a string key matches any redaction pattern
 */
function shouldRedact(key) {
  if (typeof key !== 'string') return false;
  return REDACTION_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Recursively redact sensitive data in objects
 */
function redactSensitiveData(obj, depth = 0) {
  // Prevent infinite recursion
  if (depth > 10) return obj;

  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitives
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1));
  }

  // Handle objects
  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedact(key)) {
      // Redact the entire value
      redacted[key] = REDACTED_VALUE;
    } else if (typeof value === 'object' && value !== null) {
      // Recursively redact nested objects
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      // Keep non-sensitive values as-is
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Redact sensitive data from arguments
 */
function redactArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'string') {
      // Check if the string itself looks like a sensitive value
      // (long alphanumeric strings that might be keys/tokens)
      if (/^[A-Za-z0-9_-]{20,}$/.test(arg)) {
        return REDACTED_VALUE;
      }
      return arg;
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
    this.enableRedaction = options.enableRedaction !== false; // Default: true
    this.logLevel = options.logLevel || 'info'; // debug, info, warn, error
    this.enableTimestamps = options.enableTimestamps !== false; // Default: true
    this.enableColors = options.enableColors !== false; // Default: true

    // Log levels
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    // Colors (ANSI escape codes)
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m'
    };
  }

  /**
   * Get timestamp string
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Check if log level is enabled
   */
  isLevelEnabled(level) {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  /**
   * Format log message with colors and timestamp
   */
  formatMessage(level, args) {
    const parts = [];

    // Timestamp
    if (this.enableTimestamps) {
      const timestamp = this.enableColors
        ? `${this.colors.gray}${this.getTimestamp()}${this.colors.reset}`
        : this.getTimestamp();
      parts.push(`[${timestamp}]`);
    }

    // Level
    if (this.enableColors) {
      const levelColors = {
        debug: this.colors.blue,
        info: this.colors.green,
        warn: this.colors.yellow,
        error: this.colors.red
      };
      parts.push(`${levelColors[level]}[${level.toUpperCase()}]${this.colors.reset}`);
    } else {
      parts.push(`[${level.toUpperCase()}]`);
    }

    return parts;
  }

  /**
   * Core logging function
   */
  log(level, ...args) {
    if (!this.isLevelEnabled(level)) return;

    // Redact sensitive data
    const safeArgs = this.enableRedaction ? redactArgs(args) : args;

    // Format and output
    const formatted = this.formatMessage(level, safeArgs);
    console[level === 'debug' ? 'log' : level](...formatted, ...safeArgs);
  }

  /**
   * Debug level
   */
  debug(...args) {
    this.log('debug', ...args);
  }

  /**
   * Info level (default)
   */
  info(...args) {
    this.log('info', ...args);
  }

  /**
   * Warning level
   */
  warn(...args) {
    this.log('warn', ...args);
  }

  /**
   * Error level
   */
  error(...args) {
    this.log('error', ...args);
  }

  /**
   * Log without redaction (use carefully!)
   */
  unsafe(...args) {
    const originalRedaction = this.enableRedaction;
    this.enableRedaction = false;
    this.info(...args);
    this.enableRedaction = originalRedaction;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT EXPORT - Singleton instance
// ═══════════════════════════════════════════════════════════════════

const logger = new SecureLogger({
  enableRedaction: true,
  logLevel: process.env.LOG_LEVEL || 'info',
  enableTimestamps: true,
  enableColors: true
});

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export { SecureLogger, logger };
export default logger;

// CommonJS support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = logger;
  module.exports.SecureLogger = SecureLogger;
  module.exports.logger = logger;
  module.exports.default = logger;
}
