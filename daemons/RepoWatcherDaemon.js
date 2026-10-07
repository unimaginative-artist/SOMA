/**
 * daemons/RepoWatcherDaemon.js
 * 
 * Sensory neuron that monitors the SOMA codebase for changes.
 */

import BaseDaemon from './BaseDaemon.js';
import chokidar from 'chokidar';
import path from 'path';

export class RepoWatcherDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            ...config,
            interval: 0 // No tick needed for event-based watcher
        });
        this.root = config.root || process.cwd();
        this.watcher = null;
        this.ignorePatterns = config.ignored || /(^|[\/\\])\..|(node_modules|dist|build)/;
    }

    async start() {
        await super.start();

        this.watcher = chokidar.watch([
            path.join(this.root, 'core/**/*.{js,mjs,cjs}'),
            path.join(this.root, 'arbiters/**/*.{js,mjs,cjs}'),
            path.join(this.root, 'frontend/**/*.{js,jsx,ts,tsx}')
        ], {
            ignored: this.ignorePatterns,
            persistent: true,
            ignoreInitial: true
        });

        this.watcher.on('change', (filePath) => {
            this.emitSignal('repo.file.changed', { 
                path: filePath,
                filename: path.basename(filePath)
            });
        });

        this.watcher.on('add', (filePath) => {
            this.emitSignal('repo.file.added', { 
                path: filePath,
                filename: path.basename(filePath)
            });
        });

        this.logger.info(`[RepoWatcher] Watching for changes in ${this.root}`);
    }

    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        await super.stop();
    }
}

export default RepoWatcherDaemon;
