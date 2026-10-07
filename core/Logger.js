// ═══════════════════════════════════════════════════════════
// FILE: core/Logger.js
// Enterprise-grade structured logging with file persistence
// ═══════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import util from 'util';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'soma.log');
const ERROR_FILE = path.join(LOG_DIR, 'soma-error.log');

// Ensure log directory exists synchronously
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

export class Logger {
    constructor(componentName) {
        this.component = componentName;
    }

    static _write(level, component, message, meta = null) {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` ${util.inspect(meta, { compact: true, depth: null, breakLength: Infinity })}` : '';
        const logLine = `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}${metaStr}\n`;

        // Console Output (Colored)
        const colors = {
            info: '\x1b[36m', // Cyan
            warn: '\x1b[33m', // Yellow
            error: '\x1b[31m', // Red
            success: '\x1b[32m', // Green
            debug: '\x1b[90m', // Gray
            reset: '\x1b[0m'
        };

        const color = colors[level] || colors.reset;
        
        // Don't log DEBUG to console in production, but write to file
        if (level !== 'debug' || process.env.NODE_ENV !== 'production') {
            console.log(`${color}[${timestamp}] [${level.toUpperCase()}] [${component}]${colors.reset} ${message}`);
            if (meta) console.dir(meta, { depth: 2, colors: true });
        }

        // File Output (Persistent)
        try {
            fs.appendFileSync(LOG_FILE, logLine);
            if (level === 'error') {
                fs.appendFileSync(ERROR_FILE, logLine);
            }
        } catch (e) {
            console.error('Failed to write to log file:', e);
        }
    }

    info(message, meta) { Logger._write('info', this.component, message, meta); }
    warn(message, meta) { Logger._write('warn', this.component, message, meta); }
    error(message, meta) { Logger._write('error', this.component, message, meta); }
    debug(message, meta) { Logger._write('debug', this.component, message, meta); }
    success(message, meta) { Logger._write('success', this.component, message, meta); }
}

export const logger = new Logger('System');
