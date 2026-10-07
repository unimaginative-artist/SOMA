function keyFor(item = {}) {
    return String(item.url || item.id || item.title || item.content || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260);
}

export async function processItem(item = {}) {
    const items = Array.isArray(item.items) ? item.items : [];
    const seen = new Set();
    const unique = [];
    const duplicates = [];
    for (const entry of items) {
        const key = keyFor(entry);
        if (!key) continue;
        if (seen.has(key)) duplicates.push(entry);
        else {
            seen.add(key);
            unique.push(entry);
        }
    }
    return {
        scannedAt: new Date().toISOString(),
        input: items.length,
        unique,
        duplicateCount: duplicates.length
    };
}

export default processItem;
