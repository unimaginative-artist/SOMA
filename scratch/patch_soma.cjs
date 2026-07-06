const fs = require('fs');

let content = fs.readFileSync('core/SomaAgenticExecutor.js', 'utf8');

const systemSearchTool = `
            system_search: {
                description: "Search the entire filesystem (all mounted volumes) for a file by name. Use this when you cannot find a file in your immediate workspace.",
                args: '{"filename":"string to search for"}',
                execute: async ({ filename }) => {
                    try {
                        const { promisify } = require('util');
                        const execFileAsync = promisify(require('child_process').execFile);
                        const { stdout } = await execFileAsync('powershell', ['-Command', \`Get-ChildItem -Path C:\\ -Filter *\${filename}* -Recurse -ErrorAction SilentlyContinue | Select-Object -First 20 FullName\`]);
                        return { matches: stdout.split('\\n').map(s => s.trim()).filter(Boolean) };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },
`;

if (!content.includes('system_search')) {
    content = content.replace(
        /search_code: \{/,
        systemSearchTool + '\n            search_code: {'
    );
    
    // Add to allowed tool observation list
    content = content.replace(
        /\['list_files', 'search_code', 'read_file'\]\.includes\(obs\.tool\)/,
        "['list_files', 'search_code', 'read_file', 'system_search'].includes(obs.tool)"
    );

    fs.writeFileSync('core/SomaAgenticExecutor.js', content, 'utf8');
    console.log('patched');
} else {
    console.log('already patched');
}
