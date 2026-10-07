function tokens(text = '') {
    return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function similarity(a, b) {
    const left = tokens(a);
    const right = tokens(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap++;
    return overlap / Math.min(left.size, right.size);
}

export async function processItem(item = {}) {
    const memories = Array.isArray(item.memories) ? item.memories : [];
    const threshold = Number(item.threshold || 0.42);
    const clusters = [];
    for (const memory of memories) {
        const content = memory.content || memory.text || String(memory);
        let placed = false;
        for (const cluster of clusters) {
            if (similarity(content, cluster.seed) >= threshold) {
                cluster.items.push(memory);
                placed = true;
                break;
            }
        }
        if (!placed) clusters.push({ seed: content, items: [memory] });
    }
    return {
        clusteredAt: new Date().toISOString(),
        input: memories.length,
        clusterCount: clusters.length,
        clusters: clusters.map(cluster => ({
            size: cluster.items.length,
            seed: String(cluster.seed).slice(0, 180),
            items: cluster.items.slice(0, 12)
        }))
    };
}

export default processItem;
