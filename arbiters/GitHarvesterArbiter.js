/**
 * arbiters/GitHarvesterArbiter.js
 *
 * Advanced Git Repo Crawler & Library Harvester for SOMA.
 * Searches GitHub, crawls code trees recursively, filters out noise,
 * and extracts reusable utility libraries, using QuadBrain to clean boilerplates.
 *
 * Lobe: KNOWLEDGE
 * Capabilities: harvest-libraries, search-repositories
 */

import { BaseArbiterV4, ArbiterRole } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
import { MockHarnessGenerator } from '../core/MockHarnessGenerator.js';

export class GitHarvesterArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            name: 'GitHarvesterArbiter',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                'harvest-libraries',
                'search-repositories'
            ],
            lobe: 'KNOWLEDGE',
            ...opts
        });
        // Scanned capabilities for ArbiterLoader:
        // ArbiterCapability.HARVEST_LIBRARIES
        // ArbiterCapability.SEARCH_REPOSITORIES

        this.rootPath = opts.rootPath || process.cwd();
        this.harvestedDir = path.join(this.rootPath, 'harvested-libraries');
        this.catalogPath = path.join(this.harvestedDir, 'catalog.json');
        this.quadBrain = opts.quadBrain || null;
        this.githubToken = opts.githubToken || process.env.GITHUB_TOKEN || null;
        this.mockGenerator = new MockHarnessGenerator({
            rootPath: this.rootPath
        });
    }

    async onInitialize() {
        await fs.mkdir(this.harvestedDir, { recursive: true });
        try {
            await fs.access(this.catalogPath);
        } catch {
            await fs.writeFile(this.catalogPath, JSON.stringify([], null, 2), 'utf-8');
        }

        // Register with MessageBroker if available
        if (this.system?.messageBroker) {
            this.system.messageBroker.registerArbiter(this.name, {
                instance: this,
                type: 'git-harvester',
                capabilities: ['harvest-libraries', 'search-repositories']
            });
        }
        console.log(`[${this.name}] 🤖 Git Harvester ready at ${this.harvestedDir}`);
    }

    /**
     * Search GitHub for repositories matching a query
     * @param {string} query 
     * @param {number} limit 
     * @returns {Promise<Array>}
     */
    async searchRepos(query, limit = 5) {
        console.log(`[${this.name}] Searching GitHub for "${query}" (limit ${limit})...`);
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+language:javascript&sort=stars&order=desc&per_page=${limit}`;
        
        const headers = {
            'User-Agent': 'SOMA-Library-Harvester/1.0.0',
            'Accept': 'application/vnd.github.v3+json'
        };
        if (this.githubToken) {
            headers['Authorization'] = `token ${this.githubToken}`;
        }

        try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
            if (!res.ok) {
                throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
            }
            const data = await res.json();
            return (data.items || []).map(item => ({
                name: item.name,
                owner: item.owner?.login,
                description: item.description,
                html_url: item.html_url,
                stars: item.stargazers_count,
                default_branch: item.default_branch || 'main'
            }));
        } catch (error) {
            console.error(`[${this.name}] GitHub search failed:`, error.message);
            return [];
        }
    }

    /**
     * Crawl a repository's file tree and harvest utility files
     * @param {string} owner 
     * @param {string} repo 
     * @param {string} branch 
     * @returns {Promise<Array>} harvested files info
     */
    async crawlAndHarvest(owner, repo, branch = 'main') {
        console.log(`[${this.name}] Crawling file tree of ${owner}/${repo} on branch ${branch}...`);
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        
        const headers = {
            'User-Agent': 'SOMA-Library-Harvester/1.0.0',
            'Accept': 'application/vnd.github.v3+json'
        };
        if (this.githubToken) {
            headers['Authorization'] = `token ${this.githubToken}`;
        }

        try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
            if (!res.ok) {
                throw new Error(`GitHub API returned ${res.status} for trees endpoint`);
            }
            const data = await res.json();
            if (!data.tree) return [];

            // Pattern filters: target helper files, exclude test/config/doc/vendor
            const utilityPattern = /\b(utils?|helpers?|math|algorithms?|strings?|arrays?|objects?|validation|dates?)\.js$/i;
            const excludePattern = /\b(test|spec|config|webpack|babel|eslint|gulp|grunt|vendor|dist|node_modules|docs|example|demo)\b/i;

            const files = data.tree.filter(entry => 
                entry.type === 'blob' && 
                utilityPattern.test(entry.path) && 
                !excludePattern.test(entry.path)
            ).slice(0, 3); // Limit to top 3 utility files per repo to keep it fast

            console.log(`[${this.name}] Found ${files.length} candidate utility files in ${owner}/${repo}`);

            const harvested = [];
            for (const file of files) {
                try {
                    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
                    const rawRes = await fetch(rawUrl, { headers: { 'User-Agent': 'SOMA-Library-Harvester/1.0.0' }, signal: AbortSignal.timeout(10000) });
                    if (!rawRes.ok) continue;
                    
                    const rawCode = await rawRes.text();
                    if (rawCode.length < 100 || rawCode.length > 80000) {
                        // Skip empty or excessively huge files
                        continue;
                    }

                    console.log(`[${this.name}] Cleaning up file: ${file.path} (${rawCode.length} bytes)...`);
                    const cleanedCode = await this._cleanLibraryCode(file.path, owner, repo, rawCode);

                    if (!cleanedCode) continue;

                    const safeFileName = `${repo}-${path.basename(file.path)}`;
                    const destPath = path.join(this.harvestedDir, safeFileName);
                    await fs.writeFile(destPath, cleanedCode, 'utf8');

                    const entry = {
                        name: safeFileName,
                        repo: `${owner}/${repo}`,
                        originalPath: file.path,
                        localPath: path.relative(this.rootPath, destPath),
                        harvestedAt: Date.now(),
                        sizeBytes: Buffer.byteLength(cleanedCode, 'utf8')
                    };

                    await this._addCatalogEntry(entry);
                    await this.mockGenerator.processLibrary(file.path, cleanedCode);
                    await this.distillLibraryToTrainingExamples(file.path, cleanedCode);
                    harvested.push(entry);
                    console.log(`[${this.name}] Harvested library successfully saved to: ${entry.localPath}`);
                } catch (fileErr) {
                    console.error(`[${this.name}] Failed to harvest file ${file.path}:`, fileErr.message);
                }
            }
            return harvested;
        } catch (error) {
            console.error(`[${this.name}] Crawl failed for ${owner}/${repo}:`, error.message);
            return [];
        }
    }

    /**
     * Search GitHub for a topic and crawl libraries from the top repos
     * @param {string} topic 
     * @param {number} repoLimit 
     * @returns {Promise<Array>} all harvested files
     */
    async harvestTopic(topic, repoLimit = 3) {
        const repos = await this.searchRepos(topic, repoLimit);
        const allHarvested = [];
        for (const repo of repos) {
            const harvested = await this.crawlAndHarvest(repo.owner, repo.name, repo.default_branch);
            allHarvested.push(...harvested);
        }
        return allHarvested;
    }

    async _cleanLibraryCode(filePath, owner, repo, rawCode) {
        if (!this.quadBrain) {
            console.warn(`[${this.name}] QuadBrain not available — saving raw code as fallback`);
            return rawCode;
        }

        const prompt = `You are SOMA's utility code refactor and library harvester.
Your task is to take raw utility/helper code crawled from a GitHub repository, strip away all framework wrapper noise, remove external dependency imports (replace with standard built-in node or browser APIs if possible, or stub/remove non-core functions), and refactor it into clean, optimized, fully self-contained ES module code.

Original File: ${filePath}
Source Repo: ${owner}/${repo}

Raw crawled code:
\`\`\`javascript
${rawCode}
\`\`\`

Rules:
1. Strip all template noise, boilerplate, unused exports/imports, disclaimers, or framework wrappers.
2. Ensure the code is self-contained. If it imports external third-party libraries, write a plain JS/Node equivalent or stub/remove that function if it's not core to the utility.
3. Modernize the code: use ES6+ features (const/let, arrow functions, destructuring).
4. Output ONLY the clean javascript code inside a javascript code block. Do not include any explanations, markdown outside the code block, or preambles.`;

        try {
            const result = await this.quadBrain.reason(prompt, {
                temperature: 0.2,
                maxTokens: 1500
            });
            const text = result.text || result.response || '';
            const match = text.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
            if (match) {
                return match[1].trim();
            }
            if (text.trim().startsWith('function') || text.trim().startsWith('export') || text.trim().startsWith('const')) {
                return text.trim();
            }
            return rawCode; // fallback
        } catch (error) {
            console.error(`[${this.name}] QuadBrain refactoring failed:`, error.message);
            return rawCode; // fallback
        }
    }

    async _addCatalogEntry(entry) {
        try {
            const catalog = JSON.parse(await fs.readFile(this.catalogPath, 'utf8'));
            // Remove existing entry for same file if it exists
            const filtered = catalog.filter(e => e.name !== entry.name);
            filtered.push(entry);
            await fs.writeFile(this.catalogPath, JSON.stringify(filtered, null, 2), 'utf8');
        } catch (err) {
            console.error(`[${this.name}] Failed to update catalog:`, err.message);
        }
    }

    async distillLibraryToTrainingExamples(filePath, cleanedCode) {
        if (!this.quadBrain) {
            console.warn(`[${this.name}] QuadBrain not available — skipping distillation`);
            return;
        }

        console.log(`[${this.name}] Distilling training examples for: ${filePath}...`);
        const prompt = `You are SOMA's neural training data generator.
Your task is to take the following clean javascript utility/helper library code, and distill it into exactly 3 high-quality, synthetic Q&A training examples.
These examples must follow SOMA's training chat structure, representing a helpful coding assistant explaining or demonstrating how to use the functions or patterns in this library.

Library Code from File (${filePath}):
\`\`\`javascript
${cleanedCode}
\`\`\`

Generate exactly 3 JSON object training examples. Each example MUST strictly match the following JSON structure:
{"messages":[{"role":"system","content":"You are SOMA, an advanced AI system."},{"role":"user","content":"[A specific coding question, task, or request related to this library]"},{"role":"assistant","content":"[A detailed explanation or code solution showing how to use the library functions to solve the user's problem]"}]}

Rules:
1. Provide ONLY valid JSON lines (one JSON object per line) matching the structure above.
2. Do not wrap the JSON lines in a markdown code block, and do not include any other text, preambles, or postambles.
3. Make sure the user queries are realistic coding questions that this library can solve, and the assistant responses demonstrate correct API usage of the library.`;

        try {
            const result = await this.quadBrain.reason(prompt, {
                temperature: 0.5,
                maxTokens: 2000
            });
            const text = result.text || result.response || '';
            
            // If the model wrapped the output in a markdown block, strip it
            let cleanText = text.trim();
            const jsonBlockMatch = cleanText.match(/```(?:json)?\n([\s\S]*?)```/);
            if (jsonBlockMatch) {
                cleanText = jsonBlockMatch[1].trim();
            }

            const validExamples = [];
            if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
                try {
                    const parsedArray = JSON.parse(cleanText);
                    if (Array.isArray(parsedArray)) {
                        for (const item of parsedArray) {
                            if (item.messages && Array.isArray(item.messages)) {
                                validExamples.push(JSON.stringify(item));
                            }
                        }
                    }
                } catch {}
            }

            if (validExamples.length === 0) {
                // Try line-by-line parsing
                const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.messages && Array.isArray(parsed.messages)) {
                            validExamples.push(JSON.stringify(parsed));
                        }
                    } catch {}
                }
            }

            if (validExamples.length === 0) {
                // Regex-based parsing to find any object containing {"messages":...}
                const matches = cleanText.match(/\{\s*"messages"\s*:\s*\[[\s\S]*?\}\s*\}/g);
                if (matches) {
                    for (const matchStr of matches) {
                        try {
                            const parsed = JSON.parse(matchStr);
                            if (parsed.messages && Array.isArray(parsed.messages)) {
                                validExamples.push(JSON.stringify(parsed));
                            }
                        } catch {}
                    }
                }
            }

            if (validExamples.length > 0) {
                const trainingFile = path.join(this.rootPath, 'data', 'training', 'harvested_libraries_distilled.jsonl');
                await fs.mkdir(path.dirname(trainingFile), { recursive: true });
                await fs.appendFile(trainingFile, validExamples.join('\n') + '\n', 'utf8');
                console.log(`[${this.name}] Successfully distilled and appended ${validExamples.length} training examples to ${trainingFile}`);
            } else {
                console.warn(`[${this.name}] Failed to parse any valid training examples from QuadBrain response. Output was:\n${text}`);
            }
        } catch (error) {
            console.error(`[${this.name}] Distillation failed:`, error.message);
        }
    }

    async getCatalog() {
        try {
            return JSON.parse(await fs.readFile(this.catalogPath, 'utf8'));
        } catch {
            return [];
        }
    }
}

export default GitHarvesterArbiter;
