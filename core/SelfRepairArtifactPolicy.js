import path from 'node:path';

export function assertRepairArtifactWrite(root, target) {
    const relative = path.relative(root, target).replace(/\\/g, '/');
    if (!/^(?:data|docs|research)\//.test(relative)) throw new Error('Artifact-only write: source changes must use modify_code');
    if (/^data\/self-modification(?:\/|$)/i.test(relative)) throw new Error('Repair governance state is written only by the repair service');
    if (/^data\/self-evolution\/(?!diagnostics(?:\/|$))/i.test(relative)) throw new Error('Evolution evidence and research plans are written only by the evaluation service');
    return relative;
}
