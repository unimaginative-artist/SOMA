/**
 * core/DeterministicTaskRouter.js
 * 
 * Deterministic router for predictable, low-risk tasks.
 * Bypasses LLM improvisation for pure direct queries like:
 *   - "Find all references to X"
 *   - "Read file Y"
 *   - "List files in Z"
 *   - "Run the tests"
 */

export function routeDeterministicTask(task = '', context = {}) {
    const text = String(task || '').trim();
    if (!text) return { matched: false };

    // 1. "Search codebase for X" / "Find all references to X"
    const searchMatch = text.match(/^(?:search(?:\s+the)?\s+codebase\s+for|find\s+all\s+(?:references|occurrences|instances)\s+(?:to|of)|grep(?:\s+for)?)\s+['"`]?([^'"`\n]+)['"`]?/i);
    if (searchMatch) {
        const pattern = searchMatch[1].trim();
        if (pattern) {
            return {
                matched: true,
                tool: 'search_code',
                args: { pattern, directory: '.' },
                reason: 'deterministic_search_code'
            };
        }
    }

    // 2. "Read file Y" / "Inspect file Y"
    const readMatch = text.match(/^(?:read|view|inspect)\s+(?:the\s+)?file\s+['"`]?([a-zA-Z0-9._/-]+\.[a-zA-Z0-9]+)['"`]?/i);
    if (readMatch) {
        const filePath = readMatch[1].trim();
        if (filePath) {
            return {
                matched: true,
                tool: 'read_file',
                args: { path: filePath },
                reason: 'deterministic_read_file'
            };
        }
    }

    // 3. "List files in Z" / "List directory Z"
    const listMatch = text.match(/^(?:list|show)\s+(?:all\s+)?files(?:\s+in\s+['"`]?([a-zA-Z0-9._/-]+)['"`]?)?/i);
    if (listMatch) {
        const directory = listMatch[1] ? listMatch[1].trim() : '.';
        return {
            matched: true,
            tool: 'list_files',
            args: { directory },
            reason: 'deterministic_list_files'
        };
    }

    // 4. "Run the tests"
    if (/^(?:run\s+(?:the\s+)?tests?|npm\s+test|execute\s+test\s+suite)$/i.test(text)) {
        return {
            matched: true,
            tool: 'run_tests',
            args: {},
            reason: 'deterministic_run_tests'
        };
    }

    return { matched: false };
}

export default routeDeterministicTask;
