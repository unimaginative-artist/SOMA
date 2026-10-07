import fs from 'node:fs';
import path from 'node:path';

export function writeJsonAtomicSafe(filePath, value, { fileSystem = fs, onError = null } = {}) {
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
        fileSystem.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
        try {
            fileSystem.renameSync(temporary, filePath);
        } catch {
            fileSystem.copyFileSync(temporary, filePath);
            try { fileSystem.unlinkSync(temporary); } catch {}
        }
        return { success: true, path: filePath };
    } catch (error) {
        try { fileSystem.unlinkSync(temporary); } catch {}
        onError?.(error);
        return { success: false, path: filePath, code: error.code || 'WRITE_ERROR', error: error.message };
    } finally {
        try {
            if (fileSystem.existsSync(temporary)) {
                fileSystem.unlinkSync(temporary);
            }
        } catch {}
    }
}

export default writeJsonAtomicSafe;
