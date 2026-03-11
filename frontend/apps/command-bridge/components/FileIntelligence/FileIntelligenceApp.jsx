
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { HardDrive, Upload, Scan, Binary } from 'lucide-react';
import { readDirectory, flattenNodes, processFileList } from './services/fileSystem.js';
import {
    ingestFiles,
    getStorageStats,
    getTags,
    checkBackendHealth
} from './services/somaStorageClient.js';
import {
    saveIndexedFiles,
    loadIndexedFiles,
    getPersistedStats,
    saveLastInvestigation,
    loadLastInvestigation,
    saveSearch,
    loadSavedSearches,
    removeSavedSearch
} from './services/persistenceService.js';
import IngestionPanel from './components/IngestionPanel.jsx';
import ChatInterface from './components/ChatInterface.jsx';
import CommandConsole from './components/CommandConsole.jsx';
import EvidenceGraph from './components/EvidenceGraph.jsx';
import FileViewer from './components/FileViewer.jsx';
import EvidenceCascade from './components/EvidenceCascade.jsx';
import { AppState } from './types.js';
import somaBackend from '../../somaBackend.js';

const FileIntelligenceApp = () => {
    const [rootNode, setRootNode] = useState(null);
    const [allNodes, setAllNodes] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [localStats, setLocalStats] = useState({ files: 0, size: 0 });
    const dropZoneRef = useRef(null);
    const [appState, setAppState] = useState(AppState.IDLE);
    const [logs, setLogs] = useState([]);
    const [ingestionProgress, setIngestionProgress] = useState(0);
    const [chatHistory, setChatHistory] = useState([]);
    const [relevantNodeIds, setRelevantNodeIds] = useState([]);
    const [activeTab, setActiveTab] = useState('tree');
    const [graphViewMode, setGraphViewMode] = useState('standard');
    const [currentUniverse, setCurrentUniverse] = useState('UNI-ALPHA');
    const [smartFolders, setSmartFolders] = useState([]);
    const [timeSliderValue, setTimeSliderValue] = useState(100);
    // eslint-disable-next-line no-unused-vars
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, nodeId: null });
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [highlightedChunk, setHighlightedChunk] = useState(undefined);
    const [scanningStatus, setScanningStatus] = useState({ filesFound: 0, currentDir: '' });
    
    // Investigative State
    const [activeInvestigation, setActiveInvestigation] = useState(null);

    // File Search Filter
    const [fileSearchQuery, setFileSearchQuery] = useState('');

    // Duplicate Detection
    const [duplicates, setDuplicates] = useState([]);
    const [showDuplicates, setShowDuplicates] = useState(false);

    // File Preview
    const [previewFile, setPreviewFile] = useState(null);

    // SOMA Backend Integration
    const [backendConnected, setBackendConnected] = useState(false);
    const [backendStats, setBackendStats] = useState(null);
    const [activeIndexJob, setActiveIndexJob] = useState(null);
    const [allowedRoots, setAllowedRoots] = useState([]);
    const [savedSearches, setSavedSearches] = useState([]);
    const [indexPaused, setIndexPaused] = useState(false);
    const [indexSettings, setIndexSettings] = useState({
        workers: 2,
        throttleMs: 0,
        maxDepth: 20,
        maxFiles: 500000,
        dedupe: true,
        useHash: false
    });

    const FILE_FILTERS = {
        code: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'],
        docs: ['md', 'txt', 'pdf', 'doc', 'docx'],
        data: ['json', 'csv', 'xml', 'yaml', 'yml'],
        config: ['env', 'ini', 'toml', 'cfg']
    };

    const log = useCallback((message, type = 'info') => {
        setLogs(prev => [...prev, { timestamp: Date.now(), message, type }]);
    }, []);

    // Check SOMA backend on mount
    useEffect(() => {
        const checkBackend = async () => {
            const isAvailable = await checkBackendHealth();
            setBackendConnected(isAvailable);
            if (isAvailable) {
                log('SOMA Backend connected - Hybrid Search enabled', 'success');
                const statsResult = await getStorageStats();
                if (statsResult.success) {
                    setBackendStats(statsResult.stats);
                }
                const rootsRes = await fetch('/api/storage/roots');
                const rootsData = await rootsRes.json().catch(() => null);
                if (rootsData?.success) setAllowedRoots(rootsData.roots || []);
                const statusRes = await fetch('/api/storage/index/status');
                const statusData = await statusRes.json().catch(() => null);
                if (statusData?.success && statusData.status?.lastScan) {
                    const state = statusData.status.lastScan.state;
                    if (state === 'running' || state === 'paused') {
                        setAppState(AppState.SCANNING);
                        setIndexPaused(state === 'paused');
                        setScanningStatus({ filesFound: statusData.status.lastScan.scanned || 0, currentDir: statusData.status.lastScan.path || '' });
                    }
                }
            } else {
                log('SOMA Backend not available - start launcher_ULTRA.mjs', 'error');
            }
        };
        checkBackend();
        // Re-check every 5 seconds if not connected
        const interval = setInterval(() => {
            if (!backendConnected) checkBackend();
        }, 5000);
        return () => clearInterval(interval);
    }, [log, backendConnected]);

    // Live index progress from backend
    useEffect(() => {
        const handleTrace = (payload) => {
            if (!payload || !payload.phase) return;
            if (!payload.phase.startsWith('storage_index_')) return;

            const { phase, jobId, path: targetPath, progress, result, error } = payload;
            if (phase === 'storage_index_start') {
                setActiveIndexJob({ jobId, path: targetPath, startedAt: Date.now() });
                setAppState(AppState.SCANNING);
                setIngestionProgress(0);
                setScanningStatus({ filesFound: 0, currentDir: targetPath });
                log(`Server indexing started: ${targetPath}`, 'info');
                return;
            }

            if (phase === 'storage_index_progress' && progress) {
                const filesFound = progress.scanned || 0;
                const indexed = progress.indexed || 0;
                setScanningStatus(prev => ({ ...prev, filesFound, currentDir: progress.path || prev.currentDir }));
                const total = Math.max(filesFound, 1);
                const pct = Math.min(100, (indexed / total) * 100);
                setIngestionProgress(Math.max(5, pct));
                return;
            }

            if (phase === 'storage_index_complete') {
                setAppState(AppState.READY);
                setIngestionProgress(100);
                log(`Server indexing complete: ${result?.indexed || 0}/${result?.scanned || 0} files`, 'success');
                setActiveIndexJob(null);
                setIndexPaused(false);
                return;
            }

            if (phase === 'storage_index_error') {
                setAppState(AppState.IDLE);
                setIngestionProgress(0);
                log(`Server indexing error: ${error}`, 'error');
                setActiveIndexJob(null);
                setIndexPaused(false);
            }
        };

        somaBackend.on('trace', handleTrace);
        somaBackend.connect();
        return () => somaBackend.off('trace', handleTrace);
    }, [log]);

    // Load persisted data on mount
    useEffect(() => {
        const loadPersisted = async () => {
            const result = await loadIndexedFiles();
            if (result.success && result.nodes.length > 0) {
                setAllNodes(result.nodes);
                if (result.rootNodes.length > 0) {
                    const root = {
                        id: 'root',
                        name: result.meta?.rootName || 'Restored Session',
                        kind: 'directory',
                        path: '/',
                        children: result.rootNodes,
                        isIndexed: true
                    };
                    setRootNode(root);
                }
                const files = result.nodes.filter(n => n.kind === 'file');
                const totalSize = result.nodes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0);
                setLocalStats({ files: files.length, size: totalSize });
                setAppState(AppState.READY);
                log(`Restored ${result.nodes.length} nodes from previous session`, 'success');
            }
            const lastInvestigation = loadLastInvestigation();
            if (lastInvestigation?.results?.length) {
                setActiveInvestigation(lastInvestigation);
            }
            setSavedSearches(loadSavedSearches());
            try {
                const raw = localStorage.getItem('soma_index_settings');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    setIndexSettings(prev => ({ ...prev, ...parsed }));
                }
            } catch {
                // ignore
            }
        };
        loadPersisted();
    }, [log]);

    useEffect(() => {
        try {
            localStorage.setItem('soma_index_settings', JSON.stringify(indexSettings));
        } catch {
            // ignore
        }
    }, [indexSettings]);

    // Autonomous Optimization Loop
    useEffect(() => {
        if (appState === AppState.READY && allNodes.length > 0) {
            const timer = setTimeout(() => {
                const deadCount = allNodes.filter(n => n.lifecycleStatus === 'dead').length;
                if (deadCount > 0) log(`SOMA: ${deadCount} dead nodes isolated in mesh.`, 'warning');
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [appState, allNodes, log]);

    const runIndexing = async (nodes) => {
        if (!backendConnected) {
            log('Cannot index - SOMA backend not connected', 'error');
            setAppState(AppState.IDLE);
            setIngestionProgress(0);
            return;
        }

        setAppState(AppState.INDEXING);
        setIngestionProgress(30);

        const allFiles = nodes.filter(n => n.kind === 'file');
        const dirs = nodes.filter(n => n.kind === 'directory');

        log(`Scanning ${allFiles.length} files...`, 'info');

        // 1. Mark Directories as Indexed (Fast)
        dirs.forEach(dir => {
            dir.isIndexed = true;
            dir.metadata = dir.metadata || {};
            dir.metadata.summary = 'Directory';
        });

        if (allFiles.length === 0) {
            setIngestionProgress(100);
            setAppState(AppState.READY);
            return;
        }

        // 2. Process Files in Batches
        const BATCH_SIZE = 3; // Keep small to avoid payload limits
        let processedCount = 0;
        let successCount = 0;

        // Helper to read file as Base64
        const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result.split(',')[1]); // Remove data: type header
            reader.onerror = error => reject(error);
        });

        for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
            const batch = allFiles.slice(i, i + BATCH_SIZE);
            const batchPayload = [];

            // Prepare batch
            for (const node of batch) {
                try {
                    let content = node.content;
                    let encoding = 'utf-8';

                    // If no text content, try reading binary for backend extraction
                    if (!content && node.fileObj) {
                        content = await readFileAsBase64(node.fileObj);
                        encoding = 'base64';
                    }

                    if (content) {
                        batchPayload.push({
                            id: node.id,
                            name: node.name,
                            path: node.path,
                            content: content,
                            encoding: encoding,
                            size: node.metadata?.size || 0,
                            metadata: {
                                ...node.metadata,
                                universe: currentUniverse
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to prep file ${node.name}:`, err);
                }
            }

            // Send batch
            if (batchPayload.length > 0) {
                try {
                    const result = await ingestFiles(batchPayload, { universe: currentUniverse });
                    if (result.success) {
                        successCount += batchPayload.length;
                        batch.forEach(n => n.isIndexed = true);
                    } else {
                        log(`Batch failed: ${result.error}`, 'warning');
                    }
                } catch (e) {
                    log(`Batch error: ${e.message}`, 'error');
                }
            }

            // Update Progress
            processedCount += batch.length;
            const percentage = 30 + (processedCount / allFiles.length) * 70;
            setIngestionProgress(percentage);
        }

        log(`Indexing complete. ${successCount}/${allFiles.length} files processed.`, 'success');
        
        // Finalize
        setIngestionProgress(100);
        setAppState(AppState.READY);

        const totalSize = allNodes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0);
        setLocalStats({ files: allFiles.length, size: totalSize });

        await saveIndexedFiles(nodes, rootNode);
    };

    const handleReset = () => {
        setRootNode(null);
        setAllNodes([]);
        setLocalStats({ files: 0, size: 0 });
        setAppState(AppState.IDLE);
        setIngestionProgress(0);
        setScanningStatus({ filesFound: 0, currentDir: '' });
        setChatHistory([]);
        setSmartFolders([]);
        setSelectedNode(null);
        setActiveInvestigation(null);
        log('Session reset.', 'info');
    };

    // Drag & Drop handlers
    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const items = e.dataTransfer.items;
        if (!items || items.length === 0) return;

        setAppState(AppState.SCANNING);
        setScanningStatus({ filesFound: 0, currentDir: 'Dropped files' });
        setIngestionProgress(0);
        log('Processing dropped files...', 'info');

        // Progress callback for scanning phase
        const onScanProgress = (progress) => {
            if (progress.type === 'file') {
                const totalFiles = progress.totalFiles || progress.count || 0;
                setScanningStatus(prev => ({ ...prev, filesFound: totalFiles }));
                // Log-scale progress for long scans (0-30%)
                const scaled = Math.min(30, 5 + Math.log10(totalFiles + 1) * 7);
                setIngestionProgress(scaled);
            } else if (progress.type === 'directory') {
                setScanningStatus(prev => ({ ...prev, currentDir: progress.name }));
            }
        };

        try {
            const allDroppedNodes = [];

            for (const item of items) {
                if (item.kind === 'file') {
                    // Check if it's a directory (using File System Access API)
                    const handle = await item.getAsFileSystemHandle?.();
                    if (handle?.kind === 'directory') {
                        setScanningStatus(prev => ({ ...prev, currentDir: handle.name }));
                        const nodes = await readDirectory(handle, null, '', onScanProgress);
                        allDroppedNodes.push(...flattenNodes(nodes));
                        if (!rootNode) {
                            setRootNode({
                                id: 'root',
                                name: handle.name,
                                kind: 'directory',
                                path: handle.name,
                                children: nodes,
                                isIndexed: false
                            });
                        }
                    } else {
                        // Single file
                        const file = item.getAsFile();
                        if (file) {
                            const processed = await processFileList([file]);
                            allDroppedNodes.push(...flattenNodes(processed));
                        }
                    }
                }
            }

            if (allDroppedNodes.length > 0) {
                const fileCount = allDroppedNodes.filter(n => n.kind === 'file').length;
                log(`Found ${fileCount} files from drop`, 'success');
                setAllNodes(prev => [...prev, ...allDroppedNodes]);
                await runIndexing(allDroppedNodes);
            } else {
                log('No valid files found in drop', 'warning');
                setAppState(AppState.IDLE);
            }
        } catch (err) {
            log(`Drop error: ${err.message}`, 'error');
            setAppState(AppState.IDLE);
        }
    }, [log, rootNode, runIndexing]);

    const handleSelectDirectory = async () => {
        if (typeof window.showDirectoryPicker === 'function') {
            try {
                const dirHandle = await window.showDirectoryPicker();
                setAppState(AppState.SCANNING);
                setScanningStatus({ filesFound: 0, currentDir: dirHandle.name });
                log(`Scanning directory: ${dirHandle.name}...`, 'info');

                // Progress callback for scanning phase
                const onScanProgress = (progress) => {
                    if (progress.type === 'file') {
                        const totalFiles = progress.totalFiles || progress.count || 0;
                        setScanningStatus(prev => ({ ...prev, filesFound: totalFiles }));
                        // Update progress bar (0-30% during scanning)
                        const scaled = Math.min(30, 5 + Math.log10(totalFiles + 1) * 7);
                        setIngestionProgress(scaled);
                    } else if (progress.type === 'directory') {
                        setScanningStatus(prev => ({ ...prev, currentDir: progress.name }));
                    }
                };

                const nodes = await readDirectory(dirHandle, null, '', onScanProgress);
                const root = { id: 'root', name: dirHandle.name, kind: 'directory', path: dirHandle.name, children: nodes, isIndexed: false };
                setRootNode(root);
                const flat = flattenNodes(nodes);
                setAllNodes(flat);
                log(`Found ${flat.filter(n => n.kind === 'file').length} files in ${flat.filter(n => n.kind === 'directory').length} directories`, 'success');
                await runIndexing(flat);
            } catch (err) {
                console.error('Directory selection error:', err);
                log(`Mount aborted: ${err.message || 'User cancelled'}`, 'error');
                setAppState(AppState.IDLE);
            }
        } else {
            log('Directory Picker API not supported.', 'error');
        }
    };

    const handleFileUpload = async (files) => {
        setAppState(AppState.SCANNING);
        const newNodes = await processFileList(files);
        const flat = flattenNodes(newNodes);
        setAllNodes(prev => [...prev, ...flat]);
        await runIndexing(flat);
    };

    const handleQuery = async (query) => {
        if (isProcessing) return;

        if (query.trim().toLowerCase().startsWith('/index ')) {
            const targetPath = query.trim().slice(7).trim();
            if (!targetPath) {
                log('Usage: /index C:\\path\\to\\folder', 'warning');
                return;
            }
            try {
                const res = await fetch('/api/storage/index', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: targetPath })
                });
                const data = await res.json();
                if (!data.success) {
                    log(`Index request failed: ${data.error || 'unknown'}`, 'error');
                } else {
                    log(`Index job queued: ${data.jobId}`, 'info');
                }
            } catch (e) {
                log(`Index request error: ${e.message}`, 'error');
            }
            return;
        }

        if (!backendConnected) {
            setChatHistory(prev => [...prev,
                { type: 'user', content: query },
                { type: 'agent', content: '**Error:** SOMA backend not connected. Start `launcher_ULTRA.mjs` first.', isStreaming: false }
            ]);
            return;
        }

        setIsProcessing(true);
        setChatHistory(prev => [...prev, { type: 'user', content: query }]);
        setChatHistory(prev => [...prev, { type: 'agent', content: 'Analyzing context...', isStreaming: true, retrievalStatus: { state: 'reading' } }]);

        try {
            let extensionFilter = null;
            const filterMatch = query.match(/^\[filter:\s*([^\]]+)\]\s*/i);
            if (filterMatch) {
                const label = filterMatch[1].trim().toLowerCase();
                extensionFilter = FILE_FILTERS[label] || null;
                query = query.replace(filterMatch[0], '').trim();
            }

            const advancedFilters = {};
            const sizeMatch = query.match(/size([<>]=?)(\d+)(kb|mb|gb)?/i);
            if (sizeMatch) {
                const op = sizeMatch[1];
                const val = parseInt(sizeMatch[2], 10);
                const unit = (sizeMatch[3] || 'b').toLowerCase();
                const factor = unit === 'gb' ? 1024 * 1024 * 1024 : unit === 'mb' ? 1024 * 1024 : unit === 'kb' ? 1024 : 1;
                const bytes = val * factor;
                if (op.includes('>')) advancedFilters.size = { $gte: bytes };
                if (op.includes('<')) advancedFilters.size = { $lte: bytes };
            }

            const pathMatch = query.match(/path:([^\s]+)/i);
            if (pathMatch) {
                advancedFilters.path = pathMatch[1];
            }

            const ownerMatch = query.match(/owner:([^\s]+)/i);
            if (ownerMatch) {
                advancedFilters.owner = ownerMatch[1];
            }

            const modifiedMatch = query.match(/modified([<>]=?)(\d{4}-\d{2}-\d{2})/i);
            if (modifiedMatch) {
                const op = modifiedMatch[1];
                const ts = new Date(modifiedMatch[2]).getTime();
                if (op.includes('>')) advancedFilters.modified = { $gte: ts };
                if (op.includes('<')) advancedFilters.modified = { $lte: ts };
            }

            // STEP 0: Conversational Query Rewriting (The "Steroids")
            // If we have history, we need to see if the user is referring to previous context.
            let effectiveQuery = query;
            
            if (chatHistory.length > 0) {
                // Take the last few turns for context
                const recentHistory = chatHistory.slice(-4).map(m => `${m.type.toUpperCase()}: ${m.content}`).join('\n');
                
                try {
                    const rewriteRes = await fetch('/api/soma/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: `Given the following conversation history, rewrite the user's latest query to be fully standalone and explicit. Resolve any pronouns (it, she, they, that) or ambiguous references.\nIf the query is already standalone, return it exactly as is. Do NOT add preamble.\n\nHISTORY:\n${recentHistory}\n\nUSER QUERY: "${query}"\n\nREWRITTEN QUERY:`, 
                            deepThinking: false // Fast response needed
                        })
                    });
                    const rewriteData = await rewriteRes.json();
                    if (rewriteData.success && rewriteData.message) {
                        const rewritten = rewriteData.message.trim().replace(/^"|"$/g, '');
                        if (rewritten.toLowerCase() !== query.toLowerCase()) {
                            log(`Contextual Rewrite: "${query}" -> "${rewritten}"`, 'info');
                            effectiveQuery = rewritten;
                        }
                    }
                } catch (err) {
                    console.warn("Query rewrite failed, using original:", err);
                }
            }

            // STEP 1: Search the Knowledge Base (RAG Retrieval) using Effective Query
            setChatHistory(prev => {
                const h = [...prev];
                h[h.length - 1].retrievalStatus = { state: 'searching' };
                h[h.length - 1].content = `Searching memory for: "${effectiveQuery}"...`;
                return h;
            });
            
            const searchRes = await fetch('/api/research/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: effectiveQuery,
                    filters: {
                        ...(extensionFilter ? { extension: { $in: extensionFilter } } : {}),
                        ...advancedFilters
                    },
                    options: { topK: 15 }
                })
            });
            
            const searchData = await searchRes.json();
            let relevantDocs = searchData.results || [];

            if (extensionFilter && extensionFilter.length > 0) {
                relevantDocs = relevantDocs.filter(r => {
                    const p = r?.metadata?.path || r?.metadata?.absolutePath || r?.path || r?.id || '';
                    const ext = p.split('.').pop()?.toLowerCase();
                    return extensionFilter.includes(ext);
                });
            }
            
            // Highlight found nodes in the UI
            if (relevantDocs.length > 0) {
                const ids = relevantDocs.map(r => r.id);
                setRelevantNodeIds(ids);
                
                // Set/Update Investigation Context
                const investigation = {
                    query: effectiveQuery,
                    results: relevantDocs
                };
                setActiveInvestigation(investigation);
                saveLastInvestigation(investigation);
                saveSearch(effectiveQuery);
                setSavedSearches(loadSavedSearches());
            }

            // STEP 2: Feed Retrieval Results to the Brain (RAG Generation)
            
            setChatHistory(prev => {
                const h = [...prev];
                h[h.length - 1].retrievalStatus = { state: 'reading' };
                return h;
            });

            const fileContext = relevantDocs.map(r => ({
                name: r.path || r.name || r.metadata?.path || r.metadata?.name || 'document',
                content: r.content || r.metadata?.summary || r.metadata?.content || 'No content'
            }));

            const historyForBrain = chatHistory
                .slice(-6)
                .map(m => ({
                    role: m.type === 'user' ? 'user' : 'assistant',
                    content: m.content || ''
                }));

            const chatRes = await fetch('/api/soma/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: query, // We send the ORIGINAL user query to the chat for natural flow, but context is from effective query
                    deepThinking: true, 
                    contextFiles: fileContext,
                    history: historyForBrain
                })
            });
            
            const chatData = await chatRes.json();
            const answer = chatData.message;

            // Update Chat UI with the Final Answer
            setChatHistory(prev => {
                const h = [...prev];
                const last = h[h.length - 1];
                
                const citations = relevantDocs.slice(0, 5).map(d => ({
                    fileId: d.id,
                    filePath: d.metadata?.path || d.metadata?.absolutePath || d.path || d.metadata?.name || d.name || d.id,
                    content: d.snippet || d.content || d.metadata?.summary || 'Matched document',
                    startOffset: d.metadata?.startOffset,
                    endOffset: d.metadata?.endOffset
                }));

                const noSourcesNote = relevantDocs.length === 0
                    ? "\n\n*(No local files matched this query. Answer based on general knowledge.)*"
                    : "";

                last.content = answer + noSourcesNote;
                last.citations = citations;
                last.isStreaming = false;
                last.retrievalStatus = { state: 'complete' };
                return h;
            });

        } catch (e) {
            log(`Retrieval error: ${e.message}`, 'error');
            setChatHistory(prev => {
                const h = [...prev];
                const last = h[h.length - 1];
                last.content = `Error: ${e.message}`;
                last.isStreaming = false;
                return h;
            });
        } finally {
            setIsProcessing(false);
        }
    };

    // Duplicate Detection
    const detectDuplicates = useCallback(() => {
        if (allNodes.length === 0) return;

        const fileNodes = allNodes.filter(n => n.kind === 'file');
        const duplicateGroups = [];
        const nameMap = new Map();
        const sizeMap = new Map();

        // Group by name
        fileNodes.forEach(node => {
            const name = node.name.toLowerCase();
            if (!nameMap.has(name)) {
                nameMap.set(name, []);
            }
            nameMap.get(name).push(node);
        });

        // Group by size (for files > 0 bytes)
        fileNodes.forEach(node => {
            const size = node.metadata?.size || 0;
            if (size > 0) {
                const key = `${size}`;
                if (!sizeMap.has(key)) {
                    sizeMap.set(key, []);
                }
                sizeMap.get(key).push(node);
            }
        });

        // Find name duplicates
        nameMap.forEach((nodes, name) => {
            if (nodes.length > 1) {
                duplicateGroups.push({
                    type: 'name',
                    key: name,
                    files: nodes,
                    count: nodes.length
                });
            }
        });

        // Find size duplicates (potential content duplicates)
        sizeMap.forEach((nodes, size) => {
            if (nodes.length > 1 && parseInt(size) > 100) { // Only files > 100 bytes
                // Check if they have different names (otherwise already caught)
                const uniqueNames = new Set(nodes.map(n => n.name.toLowerCase()));
                if (uniqueNames.size > 1) {
                    duplicateGroups.push({
                        type: 'size',
                        key: `${(parseInt(size) / 1024).toFixed(1)} KB`,
                        files: nodes,
                        count: nodes.length
                    });
                }
            }
        });

        setDuplicates(duplicateGroups);
        setShowDuplicates(true);
        log(`Found ${duplicateGroups.length} duplicate groups`, 'info');
    }, [allNodes, log]);

    // Filter nodes based on search query
    const filterNodes = useCallback((node, query) => {
        if (!query) return node;

        const lowerQuery = query.toLowerCase();

        if (node.kind === 'directory') {
            const filteredChildren = (node.children || [])
                .map(child => filterNodes(child, query))
                .filter(child => child !== null);

            // Include directory if it has matching children or its name matches
            if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerQuery)) {
                return { ...node, children: filteredChildren };
            }
            return null;
        }

        // File node - check if name matches
        return node.name.toLowerCase().includes(lowerQuery) ? node : null;
    }, []);

    const filteredRootNode = fileSearchQuery && rootNode
        ? filterNodes(rootNode, fileSearchQuery)
        : rootNode;

    // Handle file preview
    const handlePreviewFile = useCallback((node) => {
        const ext = node.name.split('.').pop()?.toLowerCase();
        const previewableExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'bmp', 'ico'];

        if (previewableExtensions.includes(ext)) {
            setPreviewFile(node);
        } else {
            // For non-previewable files, just select them
            setSelectedNode(node);
        }
    }, []);

    const openEvidenceResult = useCallback((result) => {
        const filePath = result?.metadata?.absolutePath || result?.metadata?.path || result?.path;
        if (!filePath) return;
        const snippet = result?.metadata?.startOffset !== undefined && result?.metadata?.endOffset !== undefined
            ? { startOffset: result.metadata.startOffset, endOffset: result.metadata.endOffset }
            : undefined;
        setHighlightedChunk(snippet);
        fetch('/api/storage/file-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        })
            .then(r => r.json())
            .then(data => {
                if (data?.success) {
                    setSelectedNode({
                        name: result?.metadata?.name || result?.name || filePath.split(/[\\/]/).pop(),
                        path: filePath,
                        content: data.content,
                        metadata: result?.metadata || {}
                    });
                } else {
                    setPreviewFile({
                        name: result?.metadata?.name || result?.name || filePath.split(/[\\/]/).pop(),
                        path: filePath,
                        metadata: result?.metadata || {}
                    });
                }
            })
            .catch(() => {
                setPreviewFile({
                    name: result?.metadata?.name || result?.name || filePath.split(/[\\/]/).pop(),
                    path: filePath,
                    metadata: result?.metadata || {}
                });
            });
    }, []);

    // Export data functionality
    const handleExportData = useCallback(async () => {
        if (allNodes.length === 0) {
            log('No data to export', 'warning');
            return;
        }

        const exportData = {
            exportedAt: new Date().toISOString(),
            totalFiles: allNodes.filter(n => n.kind === 'file').length,
            totalDirectories: allNodes.filter(n => n.kind === 'directory').length,
            totalSize: allNodes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0),
            files: allNodes.filter(n => n.kind === 'file').map(n => ({
                name: n.name,
                path: n.path,
                size: n.metadata?.size || 0,
                type: n.metadata?.type || 'unknown',
                extension: n.name.split('.').pop() || '',
                isIndexed: n.isIndexed || false
            })),
            duplicates: duplicates
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `soma-storage-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        log('Data exported successfully', 'success');
    }, [allNodes, duplicates, log]);

    const handleAutoCategorize = async () => {
        if (allNodes.length === 0 || isProcessing) return;

        if (!backendConnected) {
            log('Cannot auto-categorize - SOMA backend not connected', 'error');
            return;
        }

        setIsProcessing(true);
        log('SOMA: Detecting latent patterns & topics in vector space...', 'info');

        try {
            // Use Pattern Detection (K-Means) instead of just tags
            const patternRes = await fetch('/api/research/patterns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ k: 6 })
            });

            const data = await patternRes.json();

            if (!data.success || !data.analysis?.topics) {
                log('Pattern detection returned no clear topics.', 'warning');
                setIsProcessing(false);
                return;
            }

            const topics = data.analysis.topics;
            
            // Generate semantic names for topics (using LLM would be better, but we'll use representative docs for now)
            const newFolders = topics.map((topic, i) => {
                // Get a name from the first representative doc, or generic
                let name = `Topic ${i + 1}`;
                if (topic.representativeDocs && topic.representativeDocs.length > 0) {
                    const docName = topic.representativeDocs[0].preview.split('/').pop();
                    // Simple heuristic: Use file extension or part of name
                    name = `Cluster: ${docName.substring(0, 15)}...`;
                }

                return {
                    id: `topic_${Date.now()}_${i}`,
                    name: name,
                    query: `find documents related to topic ${i}`, // We'd need a way to query by cluster ID ideally, or just use the centroid text
                    color: i % 2 === 0 ? '#a855f7' : '#facc15',
                    meta: topic
                };
            });

            setSmartFolders(prev => [...prev, ...newFolders]);
            log(`SOMA: Discovered ${topics.length} latent topics from ${data.analysis.totalDocuments} vectors.`, 'success');
            
            if (data.analysis.potentialGaps.length > 0) {
                log(`SOMA: Identified ${data.analysis.potentialGaps.length} information gaps in the corpus.`, 'warning');
            }

        } catch (e) {
            log(`Clustering failed: ${e.message}`, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            <style>{`
        /* Core Theme Tokens */
        .bg-background { background-color: #0d1117; }
        .text-text-primary { color: #c9d1d9; }
        .text-text-secondary { color: #8b949e; }
        .text-text-muted { color: #6e7681; }
        .bg-surface { background-color: #161b22; }
        .bg-surfaceHighlight { background-color: #21262d; }
        .border-border { border-color: #30363d; }
        .text-accent { color: #facc15; }
        .bg-accent { background-color: #facc15; }
        
        /* Opacity modifiers for accent */
        .bg-accent\\/10 { background-color: rgba(250, 204, 21, 0.1); }
        .bg-accent\\/20 { background-color: rgba(250, 204, 21, 0.2); }
        .bg-accent\\/5 { background-color: rgba(250, 204, 21, 0.05); }
        .ring-accent\\/30 { box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.3); }

        /* Beta Universe Theme Overrides */
        .beta-theme .bg-background { background-color: #0f0518; }
        .beta-theme .bg-surface { background-color: #1a0b2e; }
        .beta-theme .text-accent { color: #d946ef; }
        .beta-theme .bg-accent { background-color: #d946ef; }
        .beta-theme .bg-accent\\/10 { background-color: rgba(217, 70, 239, 0.1); }
        .beta-theme .bg-accent\\/20 { background-color: rgba(217, 70, 239, 0.2); }
        
        /* Animation Utilities */
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.5s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #6e7681; }
      `}</style>
            <div
                className="flex h-full w-full bg-background text-text-primary font-sans overflow-hidden relative"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                ref={dropZoneRef}
            >
                {/* Drop Zone Overlay */}
                {isDragging && (
                    <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                        <div className="border-2 border-dashed border-accent rounded-2xl p-12 bg-accent/10 animate-pulse">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto text-accent mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <p className="text-lg font-bold text-accent uppercase tracking-widest">Drop Files Here</p>
                                <p className="text-sm text-text-muted mt-2">Folders or files will be indexed automatically</p>
                            </div>
                        </div>
                    </div>
                )}
                <IngestionPanel
                    logs={logs}
                    appState={appState}
                    progress={ingestionProgress}
                    scanningStatus={scanningStatus}
                    onPauseIndex={async () => {
                        await fetch('/api/storage/index/pause', { method: 'POST' });
                        setIndexPaused(true);
                    }}
                    onResumeIndex={async () => {
                        await fetch('/api/storage/index/resume', { method: 'POST' });
                        setIndexPaused(false);
                    }}
                    indexPaused={indexPaused}
                    onStartServerIndex={async (path) => {
                        await fetch('/api/storage/index', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                path,
                                options: {
                                    maxFiles: indexSettings.maxFiles,
                                    maxDepth: indexSettings.maxDepth,
                                    throttleMs: indexSettings.throttleMs,
                                    concurrency: indexSettings.workers,
                                    dedupe: indexSettings.dedupe,
                                    useHash: indexSettings.useHash
                                }
                            })
                        });
                    }}
                    allowedRoots={allowedRoots}
                    savedSearches={savedSearches}
                    onRunSearch={(q) => handleQuery(q)}
                    onSaveSearch={() => {
                        if (activeInvestigation?.query) {
                            saveSearch(activeInvestigation.query);
                            setSavedSearches(loadSavedSearches());
                        }
                    }}
                    onRemoveSearch={(q) => {
                        removeSavedSearch(q);
                        setSavedSearches(loadSavedSearches());
                    }}
                    indexSettings={indexSettings}
                    onUpdateIndexSettings={(partial) => setIndexSettings(prev => ({ ...prev, ...partial }))}
                />

                <div className="flex-1 flex flex-col relative min-w-0">
                    <header className="h-14 border-b border-border bg-background/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-50">
                        <div className="flex items-center gap-4">
                            {/* SOMA Backend Status */}
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${backendConnected ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                                <div className={`w-2 h-2 rounded-full ${backendConnected ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`}></div>
                                <span className={`text-[9px] uppercase font-bold tracking-widest ${backendConnected ? 'text-green-400' : 'text-red-400'}`}>
                                    {backendConnected ? 'SOMA Online' : 'Backend Offline'}
                                </span>
                                {backendConnected && backendStats?.stats?.acorn?.totalVectors > 0 && (
                                    <span className="text-[8px] text-green-500/60 ml-1">
                                        ({backendStats.stats.acorn.totalVectors} vectors)
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Stats Display */}
                            {localStats.files > 0 && (
                                <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10">
                                    <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                    </svg>
                                    <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
                                        {localStats.files.toLocaleString()} files
                                    </span>
                                    <span className="text-[9px] text-purple-400/60">
                                        {(localStats.size / (1024 * 1024)).toFixed(1)} MB
                                    </span>
                                </div>
                            )}
                            {appState !== AppState.IDLE && (
                                <button 
                                    onClick={handleReset} 
                                    className="flex items-center gap-2 px-3 py-1.5 text-[9px] uppercase font-bold text-text-muted hover:text-red-400 border border-red-500/20 rounded-md bg-red-500/5 hover:bg-red-500/10 transition-all shadow-[0_0_10px_rgba(239,68,68,0.1)] hover:shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                    Reset
                                </button>
                            )}
                        </div>
                    </header>

                    <div className="flex-1 flex flex-col overflow-hidden relative">
                        <div className="flex-1 min-h-0 relative flex flex-col bg-background">
                            {appState === AppState.IDLE && chatHistory.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in relative group">
                                    {/* Ambient Glow */}
                                    <div className="absolute inset-0 bg-accent/5 blur-[150px] rounded-full pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-1000"></div>
                                    
                                    {/* Main Trigger Button */}
                                    <div
                                        onClick={handleSelectDirectory}
                                        className="relative w-36 h-36 rounded-full flex items-center justify-center cursor-pointer transition-all duration-500 hover:scale-105 group/core shadow-[0_0_30px_rgba(250,204,21,0.1)]"
                                        title="Mount Local Directory"
                                    >
                                        {/* Spinning Rings */}
                                        <div className="absolute inset-0 border border-accent/20 rounded-full animate-[spin_10s_linear_infinite] group-hover/core:border-accent/40"></div>
                                        <div className="absolute inset-3 border border-dashed border-purple-500/20 rounded-full animate-[spin_15s_linear_infinite_reverse] group-hover/core:border-purple-500/40"></div>
                                        
                                        {/* Core Glow */}
                                        <div className="absolute inset-0 bg-accent/5 rounded-full blur-xl group-hover/core:bg-accent/10 transition-all duration-500"></div>
                                        
                                        {/* Icon */}
                                        <div className="relative z-10 flex flex-col items-center gap-2 text-accent group-hover/core:text-white transition-colors">
                                            <HardDrive className="w-8 h-8 stroke-[1.5]" />
                                            <Upload className="w-4 h-4 opacity-0 group-hover/core:opacity-100 transition-all duration-300 -translate-y-1 group-hover/core:translate-y-0 absolute top-full mt-2" />
                                        </div>
                                    </div>

                                    {/* Text Content */}
                                    <div className="mt-8 space-y-2 relative z-10">
                                        <h1 className="text-2xl font-bold tracking-[0.2em] text-text-primary uppercase font-mono">
                                            Initialize Knowledge Base
                                        </h1>
                                        <div className="flex items-center justify-center gap-3 text-xs text-text-muted font-mono opacity-60">
                                            <span>Mount Local Directory</span>
                                            <span className="w-1 h-1 rounded-full bg-accent"></span>
                                            <span>Drag & Drop</span>
                                        </div>
                                    </div>

                                    {/* Capabilities Badges */}
                                    <div className="mt-12 flex gap-4 opacity-40 group-hover:opacity-80 transition-opacity duration-500">
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[10px] text-text-secondary uppercase tracking-wider">
                                            <Scan className="w-3 h-3" /> Vector Index
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[10px] text-text-secondary uppercase tracking-wider">
                                            <Binary className="w-3 h-3" /> Hybrid Search
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <ChatInterface history={chatHistory} appState={appState} onCitationClick={(c) => {
                                    const n = allNodes.find(node => node.id === c.fileId);
                                    if (n) setSelectedNode(n);
                                    else if (c?.filePath) {
                                        openEvidenceResult({ metadata: { path: c.filePath, name: c.filePath.split('/').pop(), startOffset: c.startOffset, endOffset: c.endOffset } });
                                    }
                                }} />
                            )}
                        </div>

                        <div className="h-[42%] shrink-0 border-t border-border bg-surface flex flex-col relative z-20 shadow-[0_-8px_40px_rgba(0,0,0,0.4)]">
                            <div className="flex items-center px-6 h-12 border-b border-border bg-black/20 justify-between shrink-0">
                                <div className="flex items-center gap-4">
                                    <div className="flex bg-surfaceHighlight/30 p-1 rounded-lg">
                                        <button onClick={() => setActiveTab('tree')} className={`p-2 rounded-md transition-all ${activeTab === 'tree' ? 'bg-white/5 text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`} title="FileSystem Tree">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                        </button>
                                        <button onClick={() => setActiveTab('graph')} className={`p-2 rounded-md transition-all ${activeTab === 'graph' ? 'bg-white/5 text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`} title="Evidence Graph">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                        </button>
                                        <button onClick={() => setActiveTab('evidence')} className={`p-2 rounded-md transition-all ${activeTab === 'evidence' ? 'bg-white/5 text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`} title="Evidence Cascade">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7" />
                                            </svg>
                                        </button>
                                    </div>

                                    {/* File Search (Moved to Header) */}
                                    {activeTab === 'tree' && (
                                        <div className="relative w-64">
                                            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                            <input
                                                type="text"
                                                value={fileSearchQuery}
                                                onChange={(e) => setFileSearchQuery(e.target.value)}
                                                placeholder="Search files..."
                                                className="w-full pl-8 pr-4 py-1.5 text-[10px] bg-black/40 border border-white/5 rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-all font-mono"
                                            />
                                            {fileSearchQuery && (
                                                <button
                                                    onClick={() => setFileSearchQuery('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Tools (Moved to Header) */}
                                    {activeTab === 'tree' && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={detectDuplicates}
                                                className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold text-accent hover:text-white transition-all uppercase tracking-widest border border-accent/20 rounded-md bg-accent/5 hover:bg-accent/20 shadow-sm"
                                                title="Find Duplicate Files"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                                Duplicates
                                            </button>

                                            <button
                                                onClick={handleAutoCategorize}
                                                className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold text-purple-400 hover:text-white transition-all uppercase tracking-widest border border-purple-500/20 rounded-md bg-purple-500/5 hover:bg-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.1)] hover:shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                                                title="SOMA AI Auto-categorization"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                                Auto-Group
                                            </button>

                                            <button
                                                onClick={handleExportData}
                                                className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold text-accent hover:text-white transition-all uppercase tracking-widest border border-accent/20 rounded-md bg-accent/5 hover:bg-accent/20 shadow-sm"
                                                title="Export Storage Data"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                                Export
                                            </button>
                                            
                                            <div className="h-6 w-px bg-white/10 mx-1"></div>
                                        </div>
                                    )}

                                    {activeTab === 'graph' && (
                                        <div className="flex items-center gap-4">
                                            <div className="flex bg-black/40 rounded p-1 border border-white/5">
                                                {['standard', 'lifecycle', 'heatmap'].map(m => (
                                                    <button key={m} onClick={() => setGraphViewMode(m)} className={`px-2 py-0.5 rounded text-[8px] uppercase font-mono ${graphViewMode === m ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}>{m}</button>
                                                ))}
                                            </div>
                                            <input type="range" value={timeSliderValue} onChange={e => setTimeSliderValue(parseInt(e.target.value))} className="w-20 h-1 accent-accent" />
                                        </div>
                                    )}
                                    <div className="text-[10px] text-text-muted font-mono uppercase tracking-widest">{allNodes.length} NODES</div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-hidden relative">
                                {activeTab === 'tree' ? (
                                    <div
                                        className="p-6 overflow-y-auto h-full custom-scrollbar animate-fade-in"
                                        onClick={(e) => {
                                            // Only unselect if clicking the background, not a file item
                                            if (e.target === e.currentTarget) {
                                                setSelectedNode(null);
                                            }
                                        }}
                                    >
                                        {/* Duplicates Panel */}
                                        {showDuplicates && duplicates.length > 0 && (
                                            <div className="mb-6 p-4 bg-orange-500/5 border border-orange-500/30 rounded-xl">
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="text-[10px] font-bold text-orange-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                        </svg>
                                                        {duplicates.length} Duplicate Groups Found
                                                    </h4>
                                                    <button
                                                        onClick={() => setShowDuplicates(false)}
                                                        className="text-text-muted hover:text-text-primary transition-colors"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                                    {duplicates.map((group, i) => (
                                                        <div key={i} className="flex items-center gap-3 p-2 bg-black/20 rounded-lg">
                                                            <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${group.type === 'name' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                                {group.type === 'name' ? 'Same Name' : 'Same Size'}
                                                            </span>
                                                            <span className="text-[10px] text-text-primary font-mono truncate flex-1">{group.key}</span>
                                                            <span className="text-[9px] text-text-muted">{group.count} files</span>
                                                            <div className="flex gap-1">
                                                                {group.files.slice(0, 3).map((f, j) => (
                                                                    <button
                                                                        key={j}
                                                                        onClick={() => setSelectedNode(f)}
                                                                        className="text-[9px] px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-text-secondary hover:text-text-primary transition-colors truncate max-w-[100px]"
                                                                        title={f.path}
                                                                    >
                                                                        {f.name}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="mb-6">
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">Semantic Clusters</h4>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {smartFolders.map(f => (
                                                    <div key={f.id} onClick={() => handleQuery(f.query)} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/5 transition-all group">
                                                        <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]"></div>
                                                        <span className="text-[10px] truncate font-mono text-text-secondary group-hover:text-text-primary uppercase tracking-wider">{f.name}</span>
                                                    </div>
                                                ))}
                                                {smartFolders.length === 0 && (
                                                    <div className="col-span-full py-6 text-center border border-dashed border-border rounded-xl">
                                                        <p className="text-[10px] text-text-muted uppercase tracking-widest italic opacity-40">No active semantic groups</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="h-px bg-border/40 mb-6"></div>

                                        {filteredRootNode && (
                                            <div className="px-1 pb-12">
                                                {fileSearchQuery && (
                                                    <div className="mb-3 text-[10px] text-text-muted">
                                                        Showing results for "<span className="text-accent">{fileSearchQuery}</span>"
                                                    </div>
                                                )}
                                                <FileTree
                                                    node={filteredRootNode}
                                                    relevantIds={relevantNodeIds}
                                                    onSelect={n => setSelectedNode(n)}
                                                    onPreview={handlePreviewFile}
                                                />
                                            </div>
                                        )}
                                        {fileSearchQuery && !filteredRootNode && (
                                            <div className="py-8 text-center text-text-muted">
                                                <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <p className="text-[11px]">No files found matching "<span className="text-accent">{fileSearchQuery}</span>"</p>
                                            </div>
                                        )}
                                    </div>
                                ) : activeTab === 'graph' ? (
                                    <EvidenceGraph investigation={activeInvestigation} onOpenFile={openEvidenceResult} />
                                ) : (
                                    <EvidenceCascade investigation={activeInvestigation} onOpenFile={openEvidenceResult} />
                                )}

                                {selectedNode && <FileViewer node={selectedNode} highlightedChunk={highlightedChunk} onClose={() => setSelectedNode(null)} />}

                                {/* File Preview Modal */}
                                {previewFile && (
                                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewFile(null)}>
                                        <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-3xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-black/20">
                                                <div className="flex items-center gap-3">
                                                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                    <span className="text-sm font-mono text-text-primary">{previewFile.name}</span>
                                                    <span className="text-[10px] text-text-muted">
                                                        {((previewFile.metadata?.size || 0) / 1024).toFixed(1)} KB
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setPreviewFile(null)}
                                                    className="p-1 hover:bg-white/10 rounded transition-colors"
                                                >
                                                    <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <div className="p-4 overflow-auto max-h-[calc(80vh-60px)] flex items-center justify-center bg-black/40">
                                                <FilePreview file={previewFile} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <CommandConsole onQuery={handleQuery} onFileUpload={handleFileUpload} isProcessing={isProcessing} appState={appState} />
                    </div>
                </div>
            </div>
        </>
    );
};

// File Preview Component
const FilePreview = ({ file }) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const [imageUrl, setImageUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadPreview = async () => {
            setLoading(true);
            setError(null);

            try {
                // If we have a file handle, read from it
                if (file.handle) {
                    const fileData = await file.handle.getFile();
                    const url = URL.createObjectURL(fileData);
                    setImageUrl(url);
                } else if (file.path) {
                    // Try to load via backend API
                    const response = await fetch(`/api/storage/file-preview?path=${encodeURIComponent(file.path)}`);
                    if (response.ok) {
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        setImageUrl(url);
                    } else {
                        setError('Could not load preview');
                    }
                } else if (file.content && typeof file.content === 'string') {
                    // For SVG or text-based images
                    if (ext === 'svg') {
                        const blob = new Blob([file.content], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(blob);
                        setImageUrl(url);
                    }
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        loadPreview();

        return () => {
            if (imageUrl) URL.revokeObjectURL(imageUrl);
        };
    }, [file]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center p-8">
                <svg className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-text-muted">{error}</p>
                <p className="text-xs text-text-muted/50 mt-1">File path: {file.path}</p>
            </div>
        );
    }

    // Image preview
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'].includes(ext)) {
        return imageUrl ? (
            <img
                src={imageUrl}
                alt={file.name}
                className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
            />
        ) : (
            <div className="text-center p-8 text-text-muted">
                <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">Image preview not available</p>
                <p className="text-xs text-text-muted/50 mt-1">Drop the file again to enable preview</p>
            </div>
        );
    }

    // PDF preview
    if (ext === 'pdf') {
        return imageUrl ? (
            <iframe
                src={imageUrl}
                className="w-full h-[60vh] rounded-lg border border-white/10"
                title={file.name}
            />
        ) : (
            <div className="text-center p-8 text-text-muted">
                <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">PDF preview not available</p>
            </div>
        );
    }

    return (
        <div className="text-center p-8 text-text-muted">
            <p className="text-sm">Preview not supported for .{ext} files</p>
        </div>
    );
};

const FileTree = ({ node, relevantIds, onSelect, onPreview }) => {
    const [isOpen, setIsOpen] = useState(true);
    const isRelevant = relevantIds.includes(node.id);
    const isDir = node.kind === 'directory';

    // Check if file is previewable
    const ext = node.name.split('.').pop()?.toLowerCase();
    const isPreviewable = !isDir && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'bmp', 'ico'].includes(ext);

    // Randomized deterministic highlighting colors for tree items
    const getHighlightColor = () => {
        if (!isRelevant) return '';
        const hash = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return hash % 2 === 0 ? 'accent' : 'purple-500';
    };

    const highlightColor = getHighlightColor();

    const getIcon = () => {
        if (isDir) {
            return {
                icon: (
                    <svg className={`w-3.5 h-3.5 ${isOpen ? 'text-accent' : 'text-blue-500'} shrink-0`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                ),
                indicator: isOpen ? '▼' : '▶'
            };
        }

        let color = "text-text-muted";
        let iconPath = <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM13 3.5L18.5 9H13V3.5zM6 20V4h6v6h6v10H6z" />;

        switch (ext) {
            case 'ts': case 'tsx':
                color = "text-blue-400";
                iconPath = <path d="M15.8 5.4c-.6-.4-1.3-.6-2-.6-2.1 0-3.8 1.7-3.8 3.8 0 2.1 1.7 3.8 3.8 3.8.7 0 1.4-.2 2-.6v2c-.6.4-1.3.6-2 .6-3.2 0-5.8-2.6-5.8-5.8s2.6-5.8 5.8-5.8c.7 0 1.4.2 2 .6v2zM17 18.5h-2v-1h2v1zM20 18.5h-2v-1h2v1z" />;
                break;
            case 'js': case 'jsx':
                color = "text-yellow-400";
                iconPath = <path d="M3 3h18v18H3V3zm14.5 13.5c0-.8-.4-1.2-1.2-1.5-.4-.2-.8-.3-1.1-.4-.3-.1-.5-.2-.5-.4 0-.2.2-.3.5-.3s.5.1.7.3l.8-.8c-.3-.3-.8-.5-1.5-.5-.8 0-1.3.4-1.3 1.2 0 .8.4 1.2 1.2 1.5.4.2.8.3 1.1.4.3.1.5.2.5.4 0 .2-.2.3-.5.3s-.5-.1-.7-.3l-.8.8c.3.3.8.5 1.5.5.9.1 1.3-.5 1.3-1.2zM12.4 12v4.8c0 .8-.4 1.2-1.1 1.2-.7 0-1.1-.4-1.1-1.2v-.8l-.9.8c.2.8.8 1.2 1.8 1.2 1.3 0 2.1-.8 2.1-2.2V12h-.8z" />;
                break;
            case 'py':
                color = "text-green-500";
                iconPath = <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5z" />;
                break;
            case 'json':
                color = "text-orange-400";
                iconPath = <path d="M5 3h2v2H5V3zm4 0h10v2H9V3zM5 7h2v2H5V7zm4 0h10v2H9V7zm-4 4h2v2H5v-2zm4 0h10v2H9v-2zm-4 4h2v2H5v-2zm4 0h10v2H9v-2z" />;
                break;
            case 'md':
                color = "text-teal-400";
                iconPath = <path d="M20.5 3h-17C2.67 3 2 3.67 2 4.5v15c0 .83.67 1.5 1.5 1.5h17c.83 0 1.5-.67 1.5-1.5v-15c0-.83-.67-1.5-1.5-1.5zM7 17H5v-6l2 2 2-2v6H7zm9-6h-2v3h-2v-3h-2l3-3 3 3z" />;
                break;
            case 'css':
                color = "text-blue-600";
                iconPath = <path d="M5 2l.9 16.5L12 22l6.1-3.5L19 2H5zm11 6h-3.3l-.1.9H16l-.3 3.1H12.4l-.1.9h3.3l-.3 3.1-3.3 1-3.3-1L8.5 9h5.4l.1-.9H8.7l.1-.9h7.1l.1.9z" />;
                break;
            // Image files
            case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': case 'ico':
                color = "text-pink-400";
                iconPath = <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />;
                break;
            // PDF files
            case 'pdf':
                color = "text-red-400";
                iconPath = <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />;
                break;
        }

        return {
            icon: (
                <svg className={`w-3.5 h-3.5 ${color} shrink-0`} fill="currentColor" viewBox="0 0 24 24">
                    {iconPath}
                </svg>
            ),
            indicator: null
        };
    };

    const iconData = getIcon();

    return (
        <div className="ml-4 border-l border-white/5 pl-2 my-1 font-mono">
            <div
                onClick={() => isDir ? setIsOpen(!isOpen) : onSelect(node)}
                className={`group flex items-center gap-3 py-1.5 px-3 rounded-lg cursor-pointer transition-all duration-200
                 ${isRelevant
                        ? highlightColor === 'accent'
                            ? 'bg-accent/10 text-accent font-bold ring-1 ring-accent/30 scale-[1.02]'
                            : 'bg-purple-500/10 text-purple-400 font-bold ring-1 ring-purple-500/30 scale-[1.02]'
                        : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'}`}
            >
                {iconData.indicator && <span className="text-[8px] w-2 text-text-muted opacity-50">{iconData.indicator}</span>}
                {iconData.icon}
                <span className="truncate text-[11px] flex-1 tracking-tight">{node.name}</span>

                {/* Preview button for images/PDFs */}
                {isPreviewable && onPreview && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onPreview(node);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
                        title="Preview"
                    >
                        <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                )}

                {isRelevant && <div className={`w-1.5 h-1.5 rounded-full ${highlightColor === 'accent' ? 'bg-accent shadow-[0_0_8px_#facc15]' : 'bg-purple-500 shadow-[0_0_8px_#a855f7]'}`}></div>}
                {node.isVirtual && <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]"></div>}
            </div>
            {isOpen && isDir && node.children && (
                <div className="mt-1">
                    {node.children.map(c => <FileTree key={c.id} node={c} relevantIds={relevantIds} onSelect={onSelect} onPreview={onPreview} />)}
                </div>
            )}
        </div>
    );
};

export default FileIntelligenceApp;
