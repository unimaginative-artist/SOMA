const { fork } = require('child_process');
const path = require('path');

// This is the worker script that runs in a separate process
// It receives the tool path, attempts to execute it, and sends back the result.

if (process.argv[2] === 'worker') {
    const toolInterceptor = async () => {
        const filePath = process.argv[3];
        
        try {
            // Dynamic import for ESM/CommonJS compatibility
            let toolModule;
            try {
                toolModule = require(filePath);
            } catch (e) {
                // Try dynamic import if require fails (for ESM)
                toolModule = await import(`file://${filePath}`);
            }

            // Normalize export
            const func = toolModule.execute || (toolModule.default && toolModule.default.execute);
            
            if (typeof func !== 'function') {
                throw new Error("Tool does not export 'execute' function");
            }

            // Run with dummy args
            const result = await func({});
            
            process.send({ success: true, result });
        } catch (error) {
            // If it's a "missing argument" error, that's fine - code ran.
            // We serialize the error to send it back
            process.send({ 
                success: false, 
                error: error.message, 
                stack: error.stack 
            });
        }
    };

    toolInterceptor();
}

/**
 * Runs a tool verification in an isolated child process.
 * Safe from infinite loops and memory leaks affecting the main process.
 */
function verifyInChildProcess(filePath, timeout = 2000) {
    return new Promise((resolve) => {
        const child = fork(__filename, ['worker', filePath], {
            stdio: 'inherit',
            execArgv: [] // No special node flags
        });

        let finished = false;

        // Timeout Safety
        const timer = setTimeout(() => {
            if (!finished) {
                child.kill();
                finished = true;
                resolve({ success: false, error: 'Execution Timed Out (Infinite Loop Detected)' });
            }
        }, timeout);

        child.on('message', (msg) => {
            if (!finished) {
                clearTimeout(timer);
                finished = true;
                child.kill(); // We are done with this worker
                resolve(msg);
            }
        });

        child.on('error', (err) => {
            if (!finished) {
                clearTimeout(timer);
                finished = true;
                resolve({ success: false, error: `Process Error: ${err.message}` });
            }
        });

        child.on('exit', (code) => {
            if (!finished) {
                clearTimeout(timer);
                finished = true;
                if (code !== 0) {
                    resolve({ success: false, error: `Process crashed with exit code ${code}` });
                }
            }
        });
    });
}

module.exports = { verifyInChildProcess };
