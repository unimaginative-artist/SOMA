const receipts = new WeakSet();

// Called by tool-response handlers, never from a model-generated or HTTP body object.
export function sourceReadReceipt({ path, content, readAt = Date.now() }) {
    if (!path || typeof content !== 'string' || /^(?:Error:|Access Denied:)/i.test(content)) throw new Error('Successful source read required');
    const receipt = Object.freeze({ kind: 'source_read', path, content, readAt,
        claims: Object.freeze([`I read ${path}.`, `I read \`${path}\`.`]) });
    receipts.add(receipt);
    return receipt;
}

export function receiptGrounding(reply, supplied = [], now = Date.now()) {
    const valid = (Array.isArray(supplied) ? supplied : []).filter(item => receipts.has(item) && now >= item.readAt && now - item.readAt <= 30 * 60_000);
    const sentences = String(reply).split(/(?<=[.!?])\s+(?=[A-Z])/);
    const claims = valid.flatMap(item => item.claims);
    const uncheckedText = sentences.map(sentence => claims.includes(sentence.trim()) ? '[Verified source read.]' : sentence).join(' ');
    const source = valid.map(item => item.content).join('\n');
    const identifiers = String(reply).match(/\b[a-zA-Z_]\w*\(\)/g) || [];
    const codeBlocks = [...String(reply).matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1].trim()).filter(Boolean);
    return { uncheckedText, hasSource: valid.length > 0 && identifiers.every(name => source.includes(name.slice(0, -2))), receiptCount: valid.length,
        sourcePaths: valid.map(item => item.path),
        quotedBlocksVerified: codeBlocks.every(block => valid.some(item => item.content.replace(/\r\n/g, '\n').includes(block.replace(/\r\n/g, '\n')))) };
}
