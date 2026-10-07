function strongRef(value) {
    if (!value || typeof value !== 'object') return null;
    const uri = String(value.uri || '').trim();
    const cid = String(value.cid || '').trim();
    return uri.startsWith('at://') && cid ? { uri, cid } : null;
}

/** Build the AT Protocol reply refs for replying to a PostView. */
export function replyRefsFromPost(post = {}) {
    const record = post.record || {};
    const parent = strongRef(post);
    if (!parent) throw new Error('Bluesky reply target requires a valid AT URI and CID');
    const root = strongRef(record.reply?.root) || parent;
    return { parent, root, threadUri: root.uri };
}

export function validateReplyRefs(parentRef, rootRef = null) {
    const parent = strongRef(parentRef);
    if (!parent) throw new Error('Bluesky reply parent requires a valid AT URI and CID');
    const root = strongRef(rootRef) || parent;
    return { parent, root };
}

export default replyRefsFromPost;
