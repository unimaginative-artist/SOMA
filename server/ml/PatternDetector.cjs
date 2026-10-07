
const faiss = require('faiss-node');

/**
 * PatternDetector
 * 
 * Uses vector clustering to identify:
 * 1. Dominant Topics (Centroids of large clusters)
 * 2. Information Gaps (Sparse areas in vector space)
 * 3. Anomalies (Outliers far from any cluster)
 * 
 * Scalable approach: Uses K-Means on the existing FAISS vectors.
 */
class PatternDetector {
    constructor(acornAdapter) {
        this.acorn = acornAdapter;
        this.dimension = acornAdapter.dimension;
    }

    /**
     * Analyze the entire corpus for patterns
     * @param {number} k - Number of clusters (topics) to find
     */
    async analyzePatterns(k = 10) {
        if (this.acorn.metadata.length < k) {
            return { error: "Not enough data points for pattern analysis" };
        }

        // 1. Extract all vectors from the index
        // FAISS Node doesn't always make it easy to reconstruct vectors from HNSW/Flat
        // We might need to maintain a separate float array or rely on the index reconstruction if supported.
        // For 'IndexFlat', we can reconstruct. For HNSW, usually yes.
        
        const count = this.acorn.metadata.length;
        const vectors = [];
        
        try {
            for (let i = 0; i < count; i++) {
                const vec = this.acorn.index.reconstruct(i);
                vectors.push(vec);
            }
        } catch (e) {
            console.error("[PatternDetector] Vector reconstruction failed (Index type might not support it):", e);
            return { error: "Index does not support pattern analysis (reconstruction failed)" };
        }

        // 2. Perform K-Means Clustering
        // We use FAISS for K-Means as it's optimized
        console.log(`[PatternDetector] Clustering ${count} vectors into ${k} topics...`);
        
        // Train K-Means
        // Note: faiss-node API for KMeans might differ, using a simplified approach or manual if needed.
        // Since faiss-node is often barebones, we might simply use the vectors to finding centroids.
        
        // Fallback: If faiss.Kmeans isn't exposed, we use a simple JS implementation for "light" clustering
        // or check if we can use the index to search.
        
        const clusters = this._simpleKMeans(vectors, k);
        
        // 3. Analyze Clusters for Gaps/Insights
        const insights = clusters.map((cluster, idx) => {
            // Find representative docs (closest to centroid)
            const centroid = cluster.centroid;
            // Search the main index for this centroid
            const nearest = this.acorn.index.search(centroid, 5); // Top 5
            
            const docs = nearest.labels.map(id => this.acorn.metadata[id]);
            
            return {
                topicId: idx,
                size: cluster.points.length,
                density: cluster.points.length / count, // % of corpus
                representativeDocs: docs.map(d => ({ 
                    id: d.id, 
                    preview: d.name || d.path 
                })),
                // "Gap" score: Inverse of density (simplified)
                isGap: cluster.points.length < (count / k) * 0.5 
            };
        });

        // 4. Find Global Gaps (Sparse Areas)
        // Areas where we expected a cluster but found low density
        const gaps = insights.filter(i => i.isGap);

        return {
            totalDocuments: count,
            topics: insights.sort((a,b) => b.size - a.size),
            potentialGaps: gaps,
            timestamp: Date.now()
        };
    }

    _simpleKMeans(vectors, k, maxIter = 10) {
        if (vectors.length === 0) return [];
        const dim = vectors[0].length;
        
        // Initialize centroids randomly
        let centroids = [];
        for(let i=0; i<k; i++) {
            centroids.push(vectors[Math.floor(Math.random() * vectors.length)]);
        }

        let assignments = new Array(vectors.length).fill(-1);
        let clusterPoints = Array.from({length: k}, () => []);

        for(let iter=0; iter<maxIter; iter++) {
            clusterPoints = Array.from({length: k}, () => []);
            
            // Assign
            for(let i=0; i<vectors.length; i++) {
                let minDist = Infinity;
                let bestC = -1;
                for(let c=0; c<k; c++) {
                    const d = this._dist(vectors[i], centroids[c]);
                    if(d < minDist) { minDist = d; bestC = c; }
                }
                assignments[i] = bestC;
                clusterPoints[bestC].push(vectors[i]);
            }

            // Update Centroids
            for(let c=0; c<k; c++) {
                if (clusterPoints[c].length === 0) continue;
                const newCentroid = new Array(dim).fill(0);
                for(const vec of clusterPoints[c]) {
                    for(let d=0; d<dim; d++) newCentroid[d] += vec[d];
                }
                for(let d=0; d<dim; d++) newCentroid[d] /= clusterPoints[c].length;
                centroids[c] = newCentroid;
            }
        }

        return centroids.map((c, i) => ({
            centroid: c,
            points: clusterPoints[i]
        }));
    }

    _dist(v1, v2) {
        let sum = 0;
        for(let i=0; i<v1.length; i++) sum += (v1[i] - v2[i]) ** 2;
        return sum; // L2 squared (sufficient for kmeans)
    }
}

module.exports = { PatternDetector };
