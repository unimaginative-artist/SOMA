/**
 * SOMA Storage Client
 *
 * Connects FileIntelligenceApp to SOMA's backend storage/search system.
 * Uses the HybridSearchArbiter + ACORNAdapter for:
 * - Vector semantic search
 * - Full-text BM25 search
 * - Metadata filtering
 * - Auto-classification
 */

// In dev (Vite proxy) use relative URLs; in production Electron (file://) use absolute
const BACKEND_URL = import.meta.env?.VITE_SOMA_HTTP ||
  (import.meta.env?.DEV ? '' : 'http://localhost:3001');

/**
 * Query the SOMA knowledge base with natural language
 * @param {string} query - Natural language query
 * @param {object} options - Search options
 * @returns {Promise<object>} Search results with citations
 */
export async function queryStorage(query, options = {}) {
  const {
    filters = {},
    topK = 20,
    universe = 'default'
  } = options;

  try {
    const response = await fetch(`${BACKEND_URL}/api/research/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        filters: {
          ...filters,
          universe
        },
        topK
      })
    });

    if (!response.ok) {
      throw new Error(`Query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Query failed');
    }

    return {
      success: true,
      query: data.query,
      results: data.results || [],
      count: data.count || 0,
      searchTime: data.searchTime,
      stats: data.stats
    };

  } catch (error) {
    console.error('[somaStorageClient] Query error:', error);
    return {
      success: false,
      error: error.message,
      results: [],
      count: 0
    };
  }
}

/**
 * Ingest files into SOMA's storage system
 * @param {Array<object>} files - Array of file objects with name, path, content, size
 * @param {object} options - Ingestion options
 * @returns {Promise<object>} Ingestion results
 */
export async function ingestFiles(files, options = {}) {
  const {
    universe = 'default',
    onProgress = null
  } = options;

  try {
    const response = await fetch(`${BACKEND_URL}/api/research/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: files.map(f => ({
          id: f.id || `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: f.name,
          path: f.path,
          content: f.content,
          encoding: f.encoding,
          size: f.size || f.content?.length || 0,
          metadata: {
            ...f.metadata,
            name: f.name,
            path: f.path,
            universe,
            extension: f.name.split('.').pop()?.toLowerCase() || '',
            createdAt: Date.now()
          }
        })),
        options: { universe }
      })
    });

    if (!response.ok) {
      throw new Error(`Ingestion failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Ingestion failed');
    }

    return {
      success: true,
      results: data.results || {
        total: files.length,
        successful: data.indexed || files.length,
        failed: 0,
        errors: []
      }
    };

  } catch (error) {
    console.error('[somaStorageClient] Ingest error:', error);
    return {
      success: false,
      error: error.message,
      results: {
        total: files.length,
        successful: 0,
        failed: files.length,
        errors: [error.message]
      }
    };
  }
}

/**
 * Get storage statistics
 * @returns {Promise<object>} Storage stats
 */
export async function getStorageStats() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/research/stats`);

    if (!response.ok) {
      throw new Error(`Stats request failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      stats: data.stats || data
    };

  } catch (error) {
    console.error('[somaStorageClient] Stats error:', error);
    return {
      success: false,
      error: error.message,
      stats: {}
    };
  }
}

/**
 * Get all tags with optional prefix filter
 * @param {string} prefix - Tag prefix to filter by
 * @param {number} limit - Maximum number of tags to return
 * @returns {Promise<object>} Tags list
 */
export async function getTags(prefix = '', limit = 100) {
  try {
    const params = new URLSearchParams();
    if (prefix) params.append('prefix', prefix);
    if (limit) params.append('limit', limit.toString());

    const response = await fetch(`${BACKEND_URL}/api/research/tags?${params}`);

    if (!response.ok) {
      throw new Error(`Tags request failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      tags: data.tags || []
    };

  } catch (error) {
    console.error('[somaStorageClient] Tags error:', error);
    return {
      success: false,
      error: error.message,
      tags: []
    };
  }
}

/**
 * Clear the search cache
 * @returns {Promise<object>} Clear result
 */
export async function clearCache() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/research/cache/clear`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Cache clear failed: ${response.status}`);
    }

    return { success: true };

  } catch (error) {
    console.error('[somaStorageClient] Cache clear error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if SOMA backend is available
 * @returns {Promise<boolean>} True if backend is reachable
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  queryStorage,
  ingestFiles,
  getStorageStats,
  getTags,
  clearCache,
  checkBackendHealth
};
