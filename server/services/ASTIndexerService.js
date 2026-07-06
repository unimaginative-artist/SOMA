import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { parse } from '@babel/parser';
import traversePkg from '@babel/traverse';
import crypto from 'crypto';

const traverse = traversePkg.default || traversePkg;

export class ASTIndexerService {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.resolve(process.cwd(), 'soma-ast-index.db');
    this.db = null;
    this.indexingPromise = null;
  }

  initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        last_indexed INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

      CREATE TABLE IF NOT EXISTS call_sites (
        id TEXT PRIMARY KEY,
        caller_name TEXT NOT NULL,
        callee_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_number INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_call_sites_callee ON call_sites(callee_name);
      CREATE INDEX IF NOT EXISTS idx_call_sites_file ON call_sites(file_path);
    `);
    console.log('[ASTIndexer] Database initialized successfully.');
  }

  async startIndexing(rootDir) {
    if (this.indexingPromise) return this.indexingPromise;
    this.indexingPromise = (async () => {
      console.log('[ASTIndexer] Starting workspace indexing...');
      const files = await this.scanDir(rootDir || process.cwd());
      console.log(`[ASTIndexer] Found ${files.length} candidate JS/TS files to index.`);
      
      let indexedCount = 0;
      let skippedCount = 0;

      for (const file of files) {
        try {
          const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/');
          const content = await fs.readFile(file, 'utf8');
          const hash = crypto.createHash('sha256').update(content).digest('hex');

          // Check if already indexed with same hash
          const existing = this.db.prepare('SELECT hash FROM files WHERE file_path = ?').get(relativePath);
          if (existing && existing.hash === hash) {
            skippedCount++;
            continue;
          }

          // Index file
          this.indexFile(relativePath, content, hash);
          indexedCount++;
          
          // Let the event loop breathe every 10 files
          if (indexedCount % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } catch (err) {
          console.warn(`[ASTIndexer] Error indexing file ${file}:`, err.message);
        }
      }

      console.log(`[ASTIndexer] Indexing complete. Indexed: ${indexedCount}, Skipped: ${skippedCount}`);
      this.indexingPromise = null;
      return { indexedCount, skippedCount };
    })();
    return this.indexingPromise;
  }

  async scanDir(dir, filesList = []) {
    const root = process.cwd();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const rootWhitelist = [
      'server', 'core', 'arbiters', 'daemons', 'workers', 'cli', 'frontend', 'tests'
    ];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (dir === root && !rootWhitelist.includes(entry.name)) {
        continue;
      }

      // Exclusions
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.soma' ||
        entry.name === '.soma_venv' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'logs' ||
        entry.name === 'data' ||
        entry.name === 'temp'
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDir(fullPath, filesList);
      } else if (entry.isFile()) {
        if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) {
          filesList.push(fullPath);
        }
      }
    }
    return filesList;
  }

  indexFile(relativePath, content, hash) {
    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file_path = ?');
    const deleteCallsites = this.db.prepare('DELETE FROM call_sites WHERE file_path = ?');
    const insertFile = this.db.prepare('INSERT OR REPLACE INTO files (file_path, hash, last_indexed) VALUES (?, ?, ?)');
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols (id, name, type, file_path, start_line, end_line, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCallsite = this.db.prepare(`
      INSERT INTO call_sites (id, caller_name, callee_name, file_path, line_number)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Parse AST
    let ast;
    try {
      ast = parse(content, {
        sourceType: 'unambiguous',
        plugins: [
          'jsx',
          'typescript',
          'classProperties',
          'decorators-legacy',
          'dynamicImport',
          'exportDefaultFrom',
          'objectRestSpread',
          'topLevelAwait'
        ],
        errorRecovery: true
      });
    } catch (err) {
      console.warn(`[ASTIndexer] AST parse failed for ${relativePath}:`, err.message);
      return;
    }

    const symbols = [];
    const callSites = [];
    const scopeStack = [];

    const getLineRange = (node) => {
      return {
        start: node.loc?.start?.line || 0,
        end: node.loc?.end?.line || 0
      };
    };

    const getCodeFragment = (node) => {
      try {
        if (node.loc) {
          const lines = content.split('\n');
          return lines.slice(node.loc.start.line - 1, node.loc.end.line).join('\n');
        }
      } catch (e) {}
      return '';
    };

    // Traverse AST
    try {
      traverse(ast, {
        ClassDeclaration(pathNode) {
          const className = pathNode.node.id?.name;
          if (className) {
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name: className,
              type: 'class',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
          }
        },
        ClassMethod(pathNode) {
          const methodName = pathNode.node.key?.name;
          const parentClass = pathNode.findParent(p => p.isClassDeclaration());
          const className = parentClass?.node?.id?.name || 'AnonymousClass';
          const fullName = `${className}.${methodName}`;
          const loc = getLineRange(pathNode.node);
          symbols.push({
            name: fullName,
            type: 'method',
            startLine: loc.start,
            endLine: loc.end,
            content: getCodeFragment(pathNode.node)
          });
          scopeStack.push(fullName);
        },
        FunctionDeclaration(pathNode) {
          const funcName = pathNode.node.id?.name;
          if (funcName) {
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name: funcName,
              type: 'function',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
            scopeStack.push(funcName);
          } else {
            scopeStack.push('anonymous');
          }
        },
        FunctionExpression(pathNode) {
          const parent = pathNode.parentPath;
          let name = 'anonymous';
          if (parent.isVariableDeclarator() && parent.node.id?.name) {
            name = parent.node.id.name;
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name,
              type: 'function',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
          }
          scopeStack.push(name);
        },
        ArrowFunctionExpression(pathNode) {
          const parent = pathNode.parentPath;
          let name = 'anonymous';
          if (parent.isVariableDeclarator() && parent.node.id?.name) {
            name = parent.node.id.name;
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name,
              type: 'function',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
          }
          scopeStack.push(name);
        },
        CallExpression(pathNode) {
          let calleeName = '';
          const callee = pathNode.node.callee;
          if (callee.type === 'Identifier') {
            calleeName = callee.name;
          } else if (callee.type === 'MemberExpression') {
            const prop = callee.property;
            const obj = callee.object;
            if (prop.type === 'Identifier') {
              calleeName = prop.name;
              if (obj.type === 'Identifier') {
                calleeName = `${obj.name}.${prop.name}`;
              }
            }
          }

          if (calleeName) {
            const caller = scopeStack[scopeStack.length - 1] || 'global';
            callSites.push({
              caller,
              callee: calleeName,
              line: pathNode.node.loc?.start?.line || 0
            });
          }
        },
        TSInterfaceDeclaration(pathNode) {
          const interfaceName = pathNode.node.id?.name;
          if (interfaceName) {
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name: interfaceName,
              type: 'interface',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
            scopeStack.push(interfaceName);
          }
        },
        TSTypeAliasDeclaration(pathNode) {
          const typeName = pathNode.node.id?.name;
          if (typeName) {
            const loc = getLineRange(pathNode.node);
            symbols.push({
              name: typeName,
              type: 'type',
              startLine: loc.start,
              endLine: loc.end,
              content: getCodeFragment(pathNode.node)
            });
            scopeStack.push(typeName);
          }
        },
        TSTypeReference(pathNode) {
          const typeName = pathNode.node.typeName?.name;
          if (typeName) {
            const caller = scopeStack[scopeStack.length - 1] || 'global';
            callSites.push({
              caller,
              callee: typeName,
              line: pathNode.node.loc?.start?.line || 0
            });
          }
        },
        exit(pathNode) {
          if (
            pathNode.isClassMethod() ||
            pathNode.isFunctionDeclaration() ||
            pathNode.isFunctionExpression() ||
            pathNode.isArrowFunctionExpression() ||
            pathNode.isTSInterfaceDeclaration() ||
            pathNode.isTSTypeAliasDeclaration()
          ) {
            scopeStack.pop();
          }
        }
      });
    } catch (traverseErr) {
      console.warn(`[ASTIndexer] Traverse failed for ${relativePath}:`, traverseErr.message);
    }

    // Write to database transactionally
    const transaction = this.db.transaction(() => {
      deleteSymbols.run(relativePath);
      deleteCallsites.run(relativePath);
      insertFile.run(relativePath, hash, Date.now());

      for (const sym of symbols) {
        const id = crypto.randomUUID();
        insertSymbol.run(id, sym.name, sym.type, relativePath, sym.startLine, sym.endLine, sym.content);
      }

      for (const cs of callSites) {
        const id = crypto.randomUUID();
        insertCallsite.run(id, cs.caller, cs.callee, relativePath, cs.line);
      }
    });

    transaction();
  }

  computeBlastRadius(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    const normalizedPaths = paths.map(p => p.replace(/\\/g, '/'));

    // 1. Find all symbols defined in modified files
    const modifiedSymbols = [];
    for (const filePath of normalizedPaths) {
      const rows = this.db.prepare('SELECT name, type, start_line, end_line FROM symbols WHERE file_path = ?').all(filePath);
      modifiedSymbols.push(...rows.map(r => ({ ...r, filePath })));
    }

    const symbolNames = modifiedSymbols.map(s => s.name);
    
    // 2. Perform graph traversal up to 3 levels to find affected callers
    const visitedCallers = new Set();
    const blastRadius = [];

    const queue = [...symbolNames];
    let depth = 0;
    const maxDepth = 3;

    while (queue.length > 0 && depth < maxDepth) {
      const nextLevel = [];
      for (const symbol of queue) {
        const cleanSymbolName = symbol.includes('.') ? symbol.split('.').pop() : symbol;

        const callers = this.db.prepare(`
          SELECT DISTINCT caller_name, file_path, line_number 
          FROM call_sites 
          WHERE callee_name = ? OR callee_name = ? OR callee_name LIKE ?
        `).all(symbol, cleanSymbolName, `%.${cleanSymbolName}`);

        for (const caller of callers) {
          // Normalize caller file path
          const callerPath = caller.file_path.replace(/\\/g, '/');
          
          // Skip callers that are inside the modified files themselves
          if (normalizedPaths.includes(callerPath)) continue;

          const key = `${callerPath}:${caller.caller_name}:${caller.line_number}`;
          if (!visitedCallers.has(key)) {
            visitedCallers.add(key);
            
            blastRadius.push({
              callerName: caller.caller_name,
              filePath: callerPath,
              lineNumber: caller.line_number,
              calleeSymbol: symbol
            });

            if (caller.caller_name !== 'global' && caller.caller_name !== 'anonymous') {
              nextLevel.push(caller.caller_name);
            }
          }
        }
      }
      queue.length = 0;
      queue.push(...nextLevel);
      depth++;
    }

    // 3. Classify impacts
    const dbImpacts = [];
    const routeImpacts = [];

    for (const filePath of normalizedPaths) {
      if (filePath.includes('server/routes/') || filePath.includes('server/loaders/routes')) {
        routeImpacts.push(filePath);
      }
      if (filePath.includes('soma-memory.db') || filePath.includes('database') || filePath.includes('AxisStore.js') || filePath.includes('dendrite-search')) {
        dbImpacts.push(filePath);
      }
    }

    for (const entry of blastRadius) {
      if (entry.filePath.includes('server/routes/') && !routeImpacts.includes(entry.filePath)) {
        routeImpacts.push(entry.filePath);
      }
      if ((entry.filePath.includes('database') || entry.filePath.includes('Store')) && !dbImpacts.includes(entry.filePath)) {
        dbImpacts.push(entry.filePath);
      }
    }

    return {
      success: true,
      modifiedSymbols,
      blastRadius,
      dbImpacts,
      routeImpacts
    };
  }

  searchSymbols(query, limit = 50, symbolType = null) {
    if (symbolType) {
      const rows = this.db.prepare(`
        SELECT name, type, file_path, start_line, end_line 
        FROM symbols 
        WHERE name LIKE ? AND type = ?
        LIMIT ?
      `).all(`%${query}%`, symbolType, limit);
      return rows;
    }
    const rows = this.db.prepare(`
      SELECT name, type, file_path, start_line, end_line 
      FROM symbols 
      WHERE name LIKE ? 
      LIMIT ?
    `).all(`%${query}%`, limit);
    return rows;
  }

  traceTypeDependencies(typeName) {
    const references = this.db.prepare(`
      SELECT DISTINCT caller_name as caller, file_path as filePath, line_number as line 
      FROM call_sites 
      WHERE callee_name = ?
    `).all(typeName);
    return { success: true, typeName, references };
  }
}

export default ASTIndexerService;
