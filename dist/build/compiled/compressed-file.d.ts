import { ArchiveReader } from "./archive-reader";
/**
 * Represents compressed file before extraction
 */
export declare class CompressedFile {
    constructor(name: string, size: number, path: string, lastModified: number, archiveRef: ArchiveReader);
    private _name;
    private _size;
    private _path;
    private _lastModified;
    private _archiveRef;
    /**
     * File name
     */
    get name(): string;
    /**
     * File size
     */
    get size(): number;
    get lastModified(): number;
    /**
     * Extract file from archive
     * @returns {Promise<File>} extracted file
     */
    extract(): any;
    /**
     * Stream the file's contents out of the archive without materializing it.
     * Use this instead of extract() when the contents can be consumed
     * incrementally (hashing, uploading), especially for very large entries.
     * @returns {ReadableStream<Uint8Array>}
     */
    stream(options?: {
        chunkSize?: number;
    }): ReadableStream<Uint8Array>;
}
