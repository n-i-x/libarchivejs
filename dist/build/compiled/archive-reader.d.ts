export type ArchiveEntry = {
    size: number;
    path: string;
    type: string;
    lastModified: number;
    fileData: ArrayBuffer;
    fileName: string;
};
export declare class ArchiveReader {
    private file;
    private client;
    private worker;
    private _content;
    private _processed;
    constructor(file: File, client: any, worker: any);
    /**
     * Prepares file for reading
     * @returns {Promise<Archive>} archive instance
     */
    open(): Promise<ArchiveReader>;
    /**
     * Terminate worker to free up memory
     */
    close(): Promise<void>;
    /**
     * detect if archive has encrypted data
     * @returns {boolean|null} null if could not be determined
     */
    hasEncryptedData(): Promise<boolean | null>;
    /**
     * set password to be used when reading archive
     */
    usePassword(archivePassword: string): Promise<void>;
    /**
     * Set locale, defaults to en_US.UTF-8
     */
    setLocale(locale: string): Promise<void>;
    /**
     * Returns object containing directory structure and file information
     * @returns {Promise<object>}
     */
    getFilesObject(): Promise<any>;
    getFilesArray(): Promise<any[]>;
    /**
     * Streams a single entry's data. The entry is decompressed a chunk at a time
     * and never held in wasm memory in full, so entries larger than the wasm heap
     * can be read. Reading the stream slowly pauses the worker rather than
     * buffering without bound.
     */
    streamSingleFile(target: string, options?: {
        chunkSize?: number;
    }): ReadableStream<Uint8Array>;
    extractSingleFile(target: string): Promise<File>;
    /**
     * Returns object containing directory structure and extracted File objects
     * @param {Function} extractCallback
     *
     */
    extractFiles(extractCallback?: Function | undefined): Promise<any>;
}
