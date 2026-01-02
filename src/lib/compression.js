
import pako from 'pako';

/**
 * Compresses a string using pako (Deflate/Gzip) and returns a Base64 string.
 * Uses maximum compression level (9).
 * Universal (works in Browser and Node.js).
 * @param {string} text - The input string.
 * @returns {string} - The compressed Base64 string.
 */
export function compressText(text) {
    if (!text) return '';
    try {
        // Convert string to Uint8Array/Buffer
        const textEncoder = new TextEncoder();
        const inputBuffer = textEncoder.encode(text);

        // Compress
        const compressedBuffer = pako.deflate(inputBuffer, { level: 9 });

        // Convert to Base64
        // In Node, Buffer.from works. In Browser, we can use btoa or other methods, 
        // but Next.js usually polyfills Buffer or we can use a universal method.
        // For simplicity in Next.js environment, Buffer is available globally or via module.
        // To be strictly isomorphic without Node Buffer:
        return Buffer.from(compressedBuffer).toString('base64');
    } catch (e) {
        console.error('Compression error:', e);
        return text; // Fallback
    }
}

/**
 * Decompresses a Base64 encoded Deflate string back to a regular string.
 * @param {string} compressedText - The compressed Base64 string.
 * @returns {string} - The decompressed string.
 */
export function decompressText(compressedText) {
    if (!compressedText) return '';
    try {
        const buffer = Buffer.from(compressedText, 'base64');
        const decompressed = pako.inflate(buffer);
        const textDecoder = new TextDecoder();
        return textDecoder.decode(decompressed);
    } catch (e) {
        // Assume failure means it wasn't compressed (backward compatibility)
        return compressedText;
    }
}

/**
 * Compresses a JSON object/array into a Base64 string.
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
 * Decompresses a Base64 string into a JSON object/array.
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
