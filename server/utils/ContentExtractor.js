
import fs from 'fs/promises';
import path from 'path';
// Removed broken import - pdf-parse is loaded via require() below
import mammoth from 'mammoth';
import { createRequire } from 'module';
import { analyzeImageFile, formatImageAnalysisForIngestion, isImageFile } from './LocalVisionFileAnalyzer.js';

const require = createRequire(import.meta.url);

// Wrapper for PDF Parse if default import fails
const parsePDF = async (buffer) => {
    // pdf-parse is CJS, in ESM we might need to use require
    const parser = require('pdf-parse');
    if (typeof parser === 'function') return parser(buffer);
    if (typeof parser.default === 'function') return parser.default(buffer);
    if (typeof parser.PDFParse === 'function') {
        const pdf = new parser.PDFParse({ data: buffer });
        try {
            return await pdf.getText();
        } finally {
            await pdf.destroy?.();
        }
    }
    throw new Error('pdf-parse did not expose a supported parser API');
};

export class ContentExtractor {
    constructor() {
        this.supportedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.js', '.ts', '.py', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
    }

    detectType(buffer, filePath, options = {}) {
        const extFromName = path.extname(options.originalName || '').toLowerCase();
        const extFromPath = path.extname(filePath || '').toLowerCase();
        const ext = extFromName || extFromPath;
        const mime = (options.mimeType || '').toLowerCase();
        const header = buffer.subarray(0, 8);
        const asciiHeader = header.toString('latin1');

        if (asciiHeader.startsWith('%PDF')) return '.pdf';
        if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return '.jpg';
        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return '.png';
        if (asciiHeader.startsWith('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
        if (asciiHeader.startsWith('GIF8')) return '.gif';
        if (mime.startsWith('image/')) return ext || `.${mime.replace('image/', '')}`;
        if (header[0] === 0x50 && header[1] === 0x4b) {
            if (['.docx', '.xlsx', '.pptx'].includes(ext)) return ext;
            if (mime.includes('wordprocessingml')) return '.docx';
            if (mime.includes('spreadsheetml')) return '.xlsx';
            if (mime.includes('presentationml')) return '.pptx';
            return '.zip';
        }
        if (header[0] === 0x1f && header[1] === 0x8b) return '.gzip';
        if (header[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(header[1])) return '.zlib';
        return ext;
    }

    isProbablyBinary(buffer) {
        if (!buffer || buffer.length === 0) return false;
        const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
        let control = 0;
        let replacementLikely = 0;

        for (const byte of sample) {
            if (byte === 0) return true;
            if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
            if (byte >= 0x80) replacementLikely += 1;
        }

        return control / sample.length > 0.03 || replacementLikely / sample.length > 0.35;
    }

    async extract(filePath, options = {}) {
        const dataBuffer = await fs.readFile(filePath);
        const ext = this.detectType(dataBuffer, filePath, options);
        
        try {
            if (isImageFile(filePath, options.mimeType) || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
                try {
                    const result = await analyzeImageFile(filePath, {
                        mimeType: options.mimeType,
                        model: options.visionModel,
                        prompt: options.visionPrompt
                    });
                    return formatImageAnalysisForIngestion(result, filePath);
                } catch (visionError) {
                    return [
                        `[LOCAL VISION INGESTION] ${path.basename(filePath)}`,
                        'Confidence: unavailable',
                        '',
                        `Local vision analysis failed: ${visionError.message}`,
                        'The file is an image, but SOMA could not extract a semantic visual description from the current local VLM.'
                    ].join('\n');
                }
            }
            else if (ext === '.pdf') {
                const data = await parsePDF(dataBuffer);
                return data.text?.trim() || null;
            } 
            else if (ext === '.docx') {
                const result = await mammoth.extractRawText({ buffer: dataBuffer });
                return result.value?.trim() || null;
            }
            else if (ext === '.doc') {
                throw new Error('Legacy .doc extraction is not supported yet. Please convert to .docx or PDF.');
            }
            else if (['.zip', '.gzip', '.zlib', '.xlsx', '.pptx'].includes(ext)) {
                throw new Error(`Unsupported binary container (${ext}). Upload PDF, DOCX, TXT, MD, JSON, CSV, JS, TS, or PY for reflection text extraction.`);
            }
            else if (this.isProbablyBinary(dataBuffer)) {
                throw new Error('File appears to be binary/compressed, not readable text.');
            }
            else {
                return dataBuffer.toString('utf8').trim();
            }
        } catch (error) {
            console.error(`[ContentExtractor] Failed to extract ${filePath}:`, error.message);
            return null; // Return null on failure so indexer can skip or log
        }
    }
}
