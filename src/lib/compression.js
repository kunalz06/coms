
import zlib from 'zlib';

/**
 * Compresses a string using Brotli and returns a Base64 string.
 * Uses maximum compression level (11).
 * @param {string} text - The input string.
 * @returns {string} - The compressed Base64 string.
 */
export function compressText(text) {
    if (!text) return '';
    try {
        const buffer = zlib.brotliCompressSync(Buffer.from(text), {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            },
        });
        return buffer.toString('base64');
    } catch (e) {
        console.error('Compression error:', e);
        return text; // Fallback or handle error
    }
}

/**
 * Decompresses a Base64 encoded Brotli string back to a regular string.
 * @param {string} compressedText - The compressed Base64 string.
 * @returns {string} - The decompressed string.
 */
export function decompressText(compressedText) {
    if (!compressedText) return '';
    try {
        const buffer = Buffer.from(compressedText, 'base64');
        const decompressed = zlib.brotliDecompressSync(buffer);
        return decompressed.toString('utf-8');
    } catch (e) {
        // Assume failure means it wasn't compressed (backward compatibility for uncompressed messages)
        return compressedText;
    }
}

/**
 * Compresses a JSON object/array into a Base64 Brotli string.
 * @param {any} data - The JSON data.
 * @returns {string} - Compressed string.
 */
export function compressJSON(data) {
    if (data === null || data === undefined) return '';
    try {
        const jsonStr = JSON.stringify(data);
        return compressText(jsonStr);
    } catch (e) {
        console.error('JSON Compression error:', e);
        return '';
    }
}

/**
 * Decompresses a Base64 Brotli string into a JSON object/array.
 * @param {string} compressedData - The compressed string.
 * @returns {any} - The parsed JSON data.
 */
export function decompressJSON(compressedData) {
    if (!compressedData) return {};
    const jsonStr = decompressText(compressedData);
    if (!jsonStr) return {};
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('JSON Decompression error:', e);
        return {};
    }
}
