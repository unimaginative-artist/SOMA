/**
 * core/MockHarnessGenerator.js
 *
 * Autonomously parses harvested code, identifies missing third-party dependencies,
 * and generates bulletproof, ESM-compatible mock stubs in node_modules to allow
 * execution and sandbox compilation without dependency crash states.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import { isBuiltin } from 'module';

export class MockHarnessGenerator {
    constructor(opts = {}) {
        this.rootPath = opts.rootPath || process.cwd();
        this.nodeModulesPath = opts.nodeModulesPath || path.join(this.rootPath, 'node_modules');
        this.packageJsonPath = path.join(this.rootPath, 'package.json');
        this.registryPath = path.join(this.rootPath, 'data', 'mocks', 'registry.json');
    }

    /**
     * Recursively walks AST nodes
     */
    _walk(node, callback) {
        if (!node) return;
        callback(node);
        for (const key in node) {
            if (node[key] && typeof node[key] === 'object') {
                if (Array.isArray(node[key])) {
                    for (const child of node[key]) {
                        this._walk(child, callback);
                    }
                } else if (node[key].type) {
                    this._walk(node[key], callback);
                }
            }
        }
    }

    /**
     * Parses JS code and extracts all dependency names and their imported variables
     * @param {string} code 
     * @returns {Object} { [packageName]: Set(importedNames) }
     */
    identifyDependencies(code) {
        const dependencies = {};

        try {
            const ast = parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'classProperties', 'objectRestSpread', 'dynamicImport']
            });

            this._walk(ast, (node) => {
                if (node.type === 'ImportDeclaration') {
                    const lib = node.source.value;
                    if (!dependencies[lib]) {
                        dependencies[lib] = new Set();
                    }
                    for (const spec of node.specifiers) {
                        if (spec.type === 'ImportSpecifier') {
                            const importedName = spec.imported.type === 'Identifier' 
                                ? spec.imported.name 
                                : spec.imported.value;
                            if (importedName) dependencies[lib].add(importedName);
                        } else if (spec.type === 'ImportDefaultSpecifier') {
                            dependencies[lib].add('default');
                        } else if (spec.type === 'ImportNamespaceSpecifier') {
                            dependencies[lib].add('*');
                        }
                    }
                } else if (node.type === 'CallExpression' && node.callee.name === 'require') {
                    if (node.arguments.length === 1 && node.arguments[0].type === 'StringLiteral') {
                        const lib = node.arguments[0].value;
                        if (!dependencies[lib]) {
                            dependencies[lib] = new Set();
                        }
                    }
                } else if (node.type === 'ImportExpression') {
                    if (node.source && node.source.type === 'StringLiteral') {
                        const lib = node.source.value;
                        if (!dependencies[lib]) {
                            dependencies[lib] = new Set();
                        }
                    }
                }
            });
        } catch (err) {
            console.error(`[MockHarnessGenerator] Failed to parse AST:`, err.message);
            // Fallback: simple regex matching for dependencies if AST parsing fails
            const importRegex = /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
            const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            let match;
            while ((match = importRegex.exec(code)) !== null) {
                const lib = match[1];
                if (!dependencies[lib]) dependencies[lib] = new Set();
            }
            while ((match = requireRegex.exec(code)) !== null) {
                const lib = match[1];
                if (!dependencies[lib]) dependencies[lib] = new Set();
            }
        }

        return dependencies;
    }

    /**
     * Resolves scoped package name and subpath
     */
    _getPackageNameAndSubpath(specifier) {
        const parts = specifier.split('/');
        if (specifier.startsWith('@')) {
            const pkgName = parts.slice(0, 2).join('/');
            const subpath = parts.slice(2).join('/');
            return { pkgName, subpath };
        } else {
            const pkgName = parts[0];
            const subpath = parts.slice(1).join('/');
            return { pkgName, subpath };
        }
    }

    /**
     * Resolves if a package is a Node.js builtin or already declared in SOMA's package.json
     */
    async getMissingDependencies(dependencies) {
        const missing = {};
        
        // 1. Get Node builtins
        const builtins = new Set([
            'fs', 'path', 'os', 'http', 'https', 'crypto', 'child_process', 'util', 'events',
            'stream', 'dns', 'net', 'url', 'querystring', 'readline', 'zlib', 'buffer', 'module',
            'assert', 'perf_hooks', 'worker_threads', 'process', 'fs/promises'
        ]);

        // 2. Read SOMA dependencies
        let declaredDeps = new Set();
        try {
            const pkgData = JSON.parse(await fs.readFile(this.packageJsonPath, 'utf8'));
            const deps = { ...pkgData.dependencies, ...pkgData.devDependencies };
            declaredDeps = new Set(Object.keys(deps));
        } catch (e) {
            console.warn(`[MockHarnessGenerator] Failed to load package.json dependencies:`, e.message);
        }

        for (const specifier of Object.keys(dependencies)) {
            // Skip relative paths
            if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
            
            // Skip builtins
            if (builtins.has(specifier) || (typeof isBuiltin === 'function' && isBuiltin(specifier))) continue;

            const { pkgName, subpath } = this._getPackageNameAndSubpath(specifier);

            // Skip if declared in SOMA's package.json
            if (declaredDeps.has(pkgName)) continue;

            // Skip if it actually exists in node_modules (e.g. from an unlisted sub-dependency)
            const actualPkgPath = path.join(this.nodeModulesPath, pkgName);
            if (existsSync(actualPkgPath)) continue;

            if (!missing[pkgName]) {
                missing[pkgName] = {
                    namedImports: new Set(),
                    subpaths: new Set()
                };
            }

            for (const name of dependencies[specifier]) {
                missing[pkgName].namedImports.add(name);
            }
            if (subpath) {
                missing[pkgName].subpaths.add(subpath);
            }
        }

        return missing;
    }

    /**
     * Generates custom ESM mocks for a package
     */
    async generateMockForPackage(pkgName, details) {
        const packageDir = path.join(this.nodeModulesPath, pkgName);
        await fs.mkdir(packageDir, { recursive: true });

        // 1. Write package.json
        const pkgJson = {
            name: pkgName,
            version: '1.0.0-mock',
            type: 'module',
            main: './index.js'
        };
        await fs.writeFile(
            path.join(packageDir, 'package.json'), 
            JSON.stringify(pkgJson, null, 2), 
            'utf8'
        );

        // 2. Generate index.js with statically declared named exports
        const exportsList = [];
        for (const name of details.namedImports) {
            if (name !== 'default' && name !== '*') {
                exportsList.push(name);
            }
        }

        const bulletproofProxyCode = `
// Bulletproof non-thenable response mock to prevent Promise infinite recursion loops
const mockResponse = new Proxy(() => {}, {
    get: (target, prop) => {
        if (prop === 'then') return undefined; // NOT thenable
        if (prop === Symbol.iterator) return () => [][Symbol.iterator]();
        if (prop === 'toJSON') return () => ({});
        return mockThenable;
    },
    apply: () => mockThenable
});

// Thenable mock returned by function calls and property accesses
const mockThenable = new Proxy(() => {}, {
    get: (target, prop) => {
        if (prop === 'then') {
            return (onFulfilled) => {
                if (typeof onFulfilled === 'function') {
                    try {
                        return Promise.resolve(onFulfilled(mockResponse));
                    } catch {
                        return Promise.resolve(mockResponse);
                    }
                }
                return Promise.resolve(mockResponse);
            };
        }
        if (prop === Symbol.iterator) return () => [][Symbol.iterator]();
        if (prop === 'toJSON') return () => ({});
        return mockThenable;
    },
    apply: () => mockThenable
});

const mockProxy = mockThenable;
`;

        let indexCode = `${bulletproofProxyCode}\nexport default mockProxy;\n`;
        if (exportsList.length > 0) {
            indexCode += `\n// Named exports required by ESM static analysis:\n`;
            for (const name of exportsList) {
                indexCode += `export const ${name} = mockProxy;\n`;
            }
        }
        await fs.writeFile(path.join(packageDir, 'index.js'), indexCode, 'utf8');

        // 3. Write subpath files
        for (const subpath of details.subpaths) {
            // Write subpath files (e.g. lodash/map becomes map.js or map/index.js)
            const subpathFile = subpath.endsWith('.js') ? subpath : `${subpath}.js`;
            const subpathFilePath = path.join(packageDir, subpathFile);
            await fs.mkdir(path.dirname(subpathFilePath), { recursive: true });
            
            // Subpath files also export default mockProxy and any potential named exports
            await fs.writeFile(subpathFilePath, `${bulletproofProxyCode}\nexport default mockProxy;\n`, 'utf8');
        }

        console.log(`[MockHarnessGenerator] Generated mock stub for package: ${pkgName}`);
        await this._registerMock(pkgName, Array.from(details.namedImports), Array.from(details.subpaths));
    }

    /**
     * Registers generated mock in the local registry
     */
    async _registerMock(pkgName, namedImports, subpaths) {
        try {
            await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
            let registry = {};
            if (existsSync(this.registryPath)) {
                registry = JSON.parse(await fs.readFile(this.registryPath, 'utf8'));
            }
            registry[pkgName] = {
                mockedAt: Date.now(),
                namedImports,
                subpaths
            };
            await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
        } catch (e) {
            console.error(`[MockHarnessGenerator] Failed to update mock registry:`, e.message);
        }
    }

    /**
     * Process a harvested library and stub any missing dependencies
     * @param {string} filePath 
     * @param {string} code 
     */
    async processLibrary(filePath, code) {
        console.log(`[MockHarnessGenerator] Scanning ${filePath} for external dependencies...`);
        const deps = this.identifyDependencies(code);
        const missing = await this.getMissingDependencies(deps);

        const pkgNames = Object.keys(missing);
        if (pkgNames.length > 0) {
            console.log(`[MockHarnessGenerator] Detected ${pkgNames.length} missing dependencies for ${filePath}: ${pkgNames.join(', ')}`);
            for (const pkgName of pkgNames) {
                await this.generateMockForPackage(pkgName, missing[pkgName]);
            }
        } else {
            console.log(`[MockHarnessGenerator] No missing dependencies detected for ${filePath}.`);
        }
    }
}
