// ═══════════════════════════════════════════════════════════
// FILE: core/SystemValidator.js
// Rigorous Pre-Flight Checks
// "No Shortcuts" means we verify the environment before takeoff.
// ═══════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Logger } from './Logger.js';

const logger = new Logger('SystemValidator');

export class SystemValidator {
    static async runPreFlightChecks() {
        logger.info('🚀 Initiating Pre-Flight System Validation...');
        const errors = [];

        // 1. Check Node Version
        const nodeVersion = process.version;
        if (parseInt(nodeVersion.substring(1).split('.')[0]) < 18) {
            errors.push(`Node.js version too old: ${nodeVersion}. Require 18+`);
        }

        // 2. Check Write Permissions
        try {
            const testFile = path.join(process.cwd(), '.perm_test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        } catch (e) {
            errors.push(`FileSystem Error: Cannot write to project root. ${e.message}`);
        }

        // 3. Check Critical Directories
        const requiredDirs = ['.soma', 'logs', 'dist'];
        requiredDirs.forEach(dir => {
            if (!fs.existsSync(path.join(process.cwd(), dir))) {
                logger.warn(`Missing directory: ${dir}. Creating...`);
                try {
                    fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
                } catch (e) {
                    errors.push(`Failed to create ${dir}: ${e.message}`);
                }
            }
        });

        // 4. Check API Keys (Soft Fail - Warn only)
        if (!process.env.GEMINI_API_KEY) {
            logger.warn('⚠️  GEMINI_API_KEY is missing. SOMA will be brain-dead.');
        }

        // 5. Check Python Environment (Critical for Training)
        try {
            execSync('python --version', { stdio: 'ignore', timeout: 2000 });
        } catch (e) {
            logger.warn('⚠️  Python not found or timed out. Autonomous training will be disabled.');
        }

        // Final Verdict
        if (errors.length > 0) {
            logger.error('❌ PRE-FLIGHT CHECK FAILED!');
            errors.forEach(err => logger.error(`   - ${err}`));
            logger.error('Fix these issues before launching.');
            process.exit(1); // Hard Fail
        }

        logger.success('✅ Pre-Flight Checks Passed. System is go for launch.');
        return true;
    }
}
