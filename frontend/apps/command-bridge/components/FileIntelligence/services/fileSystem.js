
import { SUPPORTED_TEXT_EXTENSIONS, MAX_FILE_SIZE_BYTES } from "../constants.js";

// Helper to generate a stable ID (simple mock hash)
const generateId = (path) => {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
        const char = path.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `node_${Math.abs(hash)}`;
};

/**
 * Upload files to SOMA backend for indexing via /api/research/ingest.
 * Returns the local node tree so the UI can display them while the
 * backend indexes asynchronously.
 */
export const uploadFilesToBackend = async (files) => {
    const nodes = await processFileList(files);
    const flat = flattenNodes(nodes);
    const fileNodes = flat.filter(n => n.kind === 'file' && n.content);

    if (fileNodes.length > 0) {
        try {
            await fetch('/api/research/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    documents: fileNodes.map(n => ({
                        id: n.id,
                        name: n.name,
                        path: n.path,
                        content: n.content,
                        size: n.metadata?.size || 0,
                        metadata: { ...n.metadata, name: n.name, path: n.path }
                    }))
                })
            });
        } catch (e) {
            console.warn('[uploadFilesToBackend] Ingest failed (files still available locally):', e.message);
        }
    }

    return nodes;
}

export const readDirectory = async (
    dirHandle,
    parentId = null,
    pathPrefix = '',
    onProgress = null,
    currentDepth = 0,
    progressState = null
) => {
    const nodes = [];
    const progress = progressState || { files: 0, directories: 0 };
    const MAX_FILES = 10000; // Safety limit for browser memory
    const MAX_DEPTH = 10;
    const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', '.vscode', '.idea', 'coverage', '__pycache__'];

    if (currentDepth > MAX_DEPTH) return [];

    try {
        for await (const entry of dirHandle.values()) {
            // Safety Check
            if (nodes.length >= MAX_FILES) break;

            const path = `${pathPrefix}/${entry.name}`;
            const id = generateId(path);

            if (entry.kind === 'file') {
                // ... (Existing file reading logic) ...
                const fileHandle = entry;
                const file = await fileHandle.getFile();

                const extension = entry.name.split('.').pop()?.toLowerCase() || '';
                const isText = SUPPORTED_TEXT_EXTENSIONS?.includes(extension) || ['txt', 'js', 'md', 'json', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'ini', 'env'].includes(extension);
                const isBinaryDoc = ['pdf', 'docx', 'doc'].includes(extension);

                let content = undefined;
                
                // Read text files immediately
                if (isText && file.size < (MAX_FILE_SIZE_BYTES || 1024 * 1024 * 5)) {
                    try {
                        content = await file.text();
                    } catch (e) {
                        console.warn(`Failed to read text for ${entry.name}`, e);
                    }
                }
                // For binary docs, we don't read content here; the app will handle extraction via backend

                if (isText || isBinaryDoc) {
                    const metadata = {
                        size: file.size,
                        lastModified: file.lastModified,
                        type: file.type || 'application/octet-stream',
                        extension,
                        keywords: [],
                    };

                    progress.files += 1;
                    // Report progress using global counts
                    if (onProgress) {
                        onProgress({
                            type: 'file',
                            name: entry.name,
                            count: progress.files,
                            totalFiles: progress.files,
                            path
                        });
                    }

                    nodes.push({
                        id,
                        name: entry.name,
                        kind: 'file',
                        path,
                        handle: entry, // Keep handle for later reading
                        fileObj: file, // Keep file object for upload
                        parentId,
                        metadata,
                        content,
                        isIndexed: false
                    });
                }

            } else if (entry.kind === 'directory') {
                // Check Ignore List
                if (IGNORED_DIRS.includes(entry.name)) continue;

                // Report progress
                if (onProgress) {
                    progress.directories += 1;
                    onProgress({
                        type: 'directory',
                        name: entry.name,
                        count: progress.directories,
                        totalDirs: progress.directories,
                        path
                    });
                }

                const dirNode = {
                    id,
                    name: entry.name,
                    kind: 'directory',
                    path,
                    handle: entry,
                    parentId,
                    isIndexed: false,
                    children: []
                };

                // Recursively read children
                const children = await readDirectory(entry, id, path, onProgress, currentDepth + 1, progress);
                dirNode.children = children;
                nodes.push(dirNode);
            }
        }
    } catch (e) {
        console.warn("Directory read partial failure:", e);
    }

    return nodes.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === 'directory' ? -1 : 1;
    });
};

export const processFileList = async (fileList) => {
    const rootChildren = [];

    // Helper to sort (duplicated from readDirectory for now)
    const sortNodes = (nodes) => {
        nodes.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
        nodes.forEach(n => {
            if (n.children) sortNodes(n.children);
        });
    };

    // Convert FileList to array if needed
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList);

    // Iterate over the flat list of files
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Handle paths. Drop events often don't have webkitRelativePath.
        // If missing, we treat it as a root level file.
        let pathParts = [];
        if (file.webkitRelativePath) {
            pathParts = file.webkitRelativePath.split('/');
        } else {
            pathParts = [file.name];
        }

        // The first part is usually the Root Folder name if uploaded via folder picker,
        // but for Drag/Drop single files, it's just the filename.
        // We start processing.

        let currentLevel = rootChildren;
        let currentPathPrefix = "Upload";
        let parentId = generateId("Upload");

        // If it's a folder upload (path > 1), strictly follow structure. 
        // If it's loose files (path == 1), add to root.
        const startIndex = 0;

        for (let j = startIndex; j < pathParts.length; j++) {
            const part = pathParts[j];
            // If pathParts length is 1, it's just a file at root.
            // If pathParts length > 1, first might be root dir name, but we can just merge.

            const isFile = j === pathParts.length - 1;
            const fullPath = currentPathPrefix + '/' + part;
            const id = generateId(fullPath);

            if (isFile) {
                const extension = part.split('.').pop()?.toLowerCase() || '';
                const isSupported = SUPPORTED_TEXT_EXTENSIONS?.includes(extension) || ['txt', 'js', 'md', 'json', 'ts', 'jsx', 'tsx', 'css'].includes(extension);
                let content = undefined;

                if (isSupported && file.size < (MAX_FILE_SIZE_BYTES || 1024 * 1024 * 5)) {
                    content = await file.text();
                }

                currentLevel.push({
                    id,
                    name: part,
                    kind: 'file',
                    path: fullPath,
                    parentId,
                    isIndexed: false,
                    metadata: {
                        size: file.size,
                        lastModified: file.lastModified,
                        type: file.type || 'application/octet-stream',
                        extension,
                        keywords: []
                    },
                    content
                });
            } else {
                // Check if directory node already exists at this level
                let dirNode = currentLevel.find(n => n.kind === 'directory' && n.name === part);
                if (!dirNode) {
                    dirNode = {
                        id,
                        name: part,
                        kind: 'directory',
                        path: fullPath,
                        parentId,
                        isIndexed: false,
                        children: []
                    };
                    currentLevel.push(dirNode);
                }
                // Descend
                currentLevel = dirNode.children;
                currentPathPrefix = fullPath;
                parentId = id;
            }
        }
    }

    sortNodes(rootChildren);
    return rootChildren;
};

export const flattenNodes = (nodes) => {
    let flat = [];
    nodes.forEach(node => {
        flat.push(node);
        if (node.children) {
            flat = flat.concat(flattenNodes(node.children));
        }
    });
    return flat;
};
