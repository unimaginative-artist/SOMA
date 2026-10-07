/**
 * Persistence Service for FileIntelligence
 *
 * Saves indexed files to IndexedDB for persistence between sessions.
 * Falls back to localStorage for smaller datasets.
 */

const DB_NAME = 'soma-storage';
const DB_VERSION = 1;
const STORE_NAME = 'indexed-files';
const META_STORE = 'metadata';
const INVESTIGATION_KEY = 'soma-last-investigation';
const SAVED_SEARCHES_KEY = 'soma-saved-searches';

let db = null;

/**
 * Initialize IndexedDB
 */
async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Store for indexed files
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('path', 'path', { unique: false });
        store.createIndex('name', 'name', { unique: false });
      }

      // Store for metadata (stats, last sync, etc.)
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Save all indexed files
 */
export async function saveIndexedFiles(nodes, rootNode = null) {
  try {
    const database = await initDB();
    const tx = database.transaction([STORE_NAME, META_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE);

    // Clear existing files
    await new Promise((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onsuccess = resolve;
      clearReq.onerror = reject;
    });

    // Save each node (without handles - they can't be serialized)
    for (const node of nodes) {
      const serializable = {
        id: node.id,
        name: node.name,
        kind: node.kind,
        path: node.path,
        parentId: node.parentId,
        isIndexed: node.isIndexed,
        metadata: node.metadata,
        content: node.content,
        // Skip handle - can't serialize FileSystemHandle
        children: node.children?.map(c => c.id) || []
      };
      store.put(serializable);
    }

    // Save metadata
    metaStore.put({
      key: 'lastSave',
      value: Date.now(),
      totalFiles: nodes.filter(n => n.kind === 'file').length,
      totalSize: nodes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0),
      rootName: rootNode?.name || 'Unknown'
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    console.log(`[Persistence] Saved ${nodes.length} nodes to IndexedDB`);
    return { success: true, count: nodes.length };

  } catch (error) {
    console.error('[Persistence] Save failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load all indexed files
 */
export async function loadIndexedFiles() {
  try {
    const database = await initDB();
    const tx = database.transaction([STORE_NAME, META_STORE], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE);

    // Get all nodes
    const nodes = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });

    // Get metadata
    const meta = await new Promise((resolve, reject) => {
      const request = metaStore.get('lastSave');
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });

    if (nodes.length === 0) {
      return { success: true, nodes: [], meta: null };
    }

    // Reconstruct tree structure
    const nodeMap = new Map(nodes.map(n => [n.id, { ...n, children: [] }]));

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId);
        parent.children.push(node);
      }
    }

    // Find root nodes (no parent)
    const rootNodes = Array.from(nodeMap.values()).filter(n => !n.parentId || !nodeMap.has(n.parentId));

    console.log(`[Persistence] Loaded ${nodes.length} nodes from IndexedDB`);

    return {
      success: true,
      nodes: Array.from(nodeMap.values()),
      rootNodes,
      meta
    };

  } catch (error) {
    console.error('[Persistence] Load failed:', error);
    return { success: false, nodes: [], error: error.message };
  }
}

/**
 * Get persistence stats
 */
export async function getPersistedStats() {
  try {
    const database = await initDB();
    const tx = database.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);

    const meta = await new Promise((resolve, reject) => {
      const request = store.get('lastSave');
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });

    return meta || null;

  } catch (error) {
    return null;
  }
}

/**
 * Clear all persisted data
 */
export async function clearPersistedData() {
  try {
    const database = await initDB();
    const tx = database.transaction([STORE_NAME, META_STORE], 'readwrite');

    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(META_STORE).clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    console.log('[Persistence] Cleared all persisted data');
    return { success: true };

  } catch (error) {
    console.error('[Persistence] Clear failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Persist last investigation (lightweight)
 */
export function saveLastInvestigation(investigation) {
  try {
    if (!investigation) return;
    localStorage.setItem(INVESTIGATION_KEY, JSON.stringify({
      ...investigation,
      savedAt: Date.now()
    }));
  } catch {
    // ignore
  }
}

export function loadLastInvestigation() {
  try {
    const raw = localStorage.getItem(INVESTIGATION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSearch(query) {
  try {
    if (!query) return;
    const existing = loadSavedSearches();
    if (existing.includes(query)) return;
    existing.unshift(query);
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(existing.slice(0, 20)));
  } catch {
    // ignore
  }
}

export function loadSavedSearches() {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function removeSavedSearch(query) {
  try {
    const existing = loadSavedSearches().filter(q => q !== query);
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(existing));
  } catch {
    // ignore
  }
}

export default {
  saveIndexedFiles,
  loadIndexedFiles,
  getPersistedStats,
  clearPersistedData,
  saveLastInvestigation,
  loadLastInvestigation,
  saveSearch,
  loadSavedSearches,
  removeSavedSearch
};
