// ═══════════════════════════════════════════════════════════
// FILE: asi/execution/SandboxRunner.cjs
// Safely execute code in an isolated environment
// ═══════════════════════════════════════════════════════════

const vm = require('vm');
const { performance } = require('perf_hooks');

class SandboxRunner {
  constructor(config = {}) {
    this.timeout = config.timeout || 5000; // 5 second default
    this.memoryLimit = config.memoryLimit || 50 * 1024 * 1024; // 50MB
    this.logger = config.logger || console;
  }

  /**
   * Run code in sandbox
   */
  async run(code, input = {}, options = {}) {
    const timeout = options.timeout || this.timeout;

    this.logger.debug(`[SandboxRunner] Executing code (timeout: ${timeout}ms)`);

    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Create sandbox context
      const sandbox = {
        input,
        output: undefined,
        console: {
          log: (...args) => this.logger.debug('[Sandbox]', ...args)
        },
        // Safe Math, JSON, etc.
        Math,
        JSON,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean
      };

      // Compile code
      const script = new vm.Script(code, {
        filename: 'solution.js',
        displayErrors: true
      });

      // Run with timeout
      const context = vm.createContext(sandbox);
      script.runInContext(context, {
        timeout,
        breakOnSigint: true
      });

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      const executionTime = endTime - startTime;
      const memoryUsed = endMemory - startMemory;

      this.logger.debug(`  Execution time: ${executionTime.toFixed(2)}ms`);
      this.logger.debug(`  Memory used: ${(memoryUsed / 1024).toFixed(2)}KB`);

      return {
        success: true,
        output: sandbox.output,
        executionTime,
        memoryUsed,
        timeout: false
      };

    } catch (error) {
      const endTime = performance.now();

      if (error.message.includes('timeout')) {
        this.logger.warn(`  Timeout after ${timeout}ms`);
        return {
          success: false,
          error: 'Execution timeout',
          timeout: true,
          executionTime: endTime - startTime
        };
      }

      this.logger.error(`  Execution error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        timeout: false,
        executionTime: endTime - startTime
      };
    }
  }

  /**
   * Test if code is safe to execute
   */
  isSafe(code) {
    // Check for dangerous operations
    const dangerousPatterns = [
      /require\s*\(/,              // No requires
      /import\s+/,                 // No imports
      /eval\s*\(/,                 // No eval
      /Function\s*\(/,             // No Function constructor
      /process\./,                 // No process access
      /__dirname|__filename/,      // No file system paths
      /child_process/,             // No child processes
      /fs\./,                      // No file system
      /\.exec\(/,                  // No exec
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        this.logger.warn(`Unsafe code detected: ${pattern}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Run with input/output test - ROBUST IMPLEMENTATION
   * Avoids string interpolation wrapper which can break syntax
   */
  async runTest(code, input, expected) {
    const timeout = this.timeout;
    const startTime = performance.now();

    try {
      // 1. Create secure context
      const sandbox = {
        console: { log: (...args) => this.logger.debug('[Sandbox]', ...args) },
        Math, JSON, Date, Array, Object, String, Number, Boolean, Set, Map,
        input // Inject input directly
      };
      
      const context = vm.createContext(sandbox);

      // 2. Execute user code to define functions
      // This catches syntax errors immediately
      try {
        vm.runInContext(code, context, { timeout, breakOnSigint: true });
      } catch (e) {
        return {
          success: false,
          error: `Compile Error: ${e.message}`,
          passed: false,
          executionTime: performance.now() - startTime
        };
      }

      // 3. Execute entry point safely
      let output;
      try {
        // Evaluate the function call within the context
        // This ensures scope is correct
        output = vm.runInContext('typeof solution === "function" ? solution(input) : (typeof main === "function" ? main(input) : undefined)', context, { timeout });
        
        if (output === undefined && !code.includes('return')) {
             throw new Error("No valid 'solution' function found or no return value");
        }
      } catch (e) {
        return {
          success: false,
          error: `Runtime Error: ${e.message}`,
          passed: false,
          executionTime: performance.now() - startTime
        };
      }

      const passed = this._compareOutputs(output, expected);
      
      return {
        success: true,
        passed,
        expected,
        actual: output,
        executionTime: performance.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        error: `System Error: ${error.message}`,
        passed: false,
        executionTime: performance.now() - startTime
      };
    }
  }

  /**
   * Run multiple tests
   */
  async runTests(code, tests) {
    const results = [];

    for (const test of tests) {
      const result = await this.runTest(code, test.input, test.expected);
      results.push({
        test: test.name || `Test ${results.length + 1}`,
        ...result
      });
    }

    const passed = results.filter(r => r.passed).length;

    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
      score: passed / results.length
    };
  }

  /**
   * Compare outputs
   */
  _compareOutputs(actual, expected) {
    if (typeof actual !== typeof expected) return false;

    if (typeof actual === 'object') {
      return JSON.stringify(actual) === JSON.stringify(expected);
    }

    return actual === expected;
  }

  /**
   * Get resource usage statistics
   */
  getResourceUsage() {
    return process.memoryUsage();
  }
}

module.exports = SandboxRunner;
