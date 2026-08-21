import * as Comlink from "comlink";
import { CompressedFile } from "./compressed-file.js";
import { cloneContent, getObjectPropReference, objectToArray } from "./utils";

export type ArchiveEntry = {
  size: number;
  path: string;
  type: string;
  lastModified: number;
  fileData: ArrayBuffer;
  fileName: string;
};

export class ArchiveReader {
  private file: File | null;
  private client: any;
  private worker: any;

  private _content: any = {};
  private _processed: number = 0;

  constructor(file: File, client: any, worker: any) {
    this.file = file;
    this.client = client;
    this.worker = worker;
  }

  /**
   * Prepares file for reading
   * @returns {Promise<Archive>} archive instance
   */
  open(): Promise<ArchiveReader> {
    this._content = {};
    this._processed = 0;
    return new Promise((resolve, _) => {
      this.client.open(
        this.file,
        Comlink.proxy(() => {
          resolve(this);
        }),
      );
    });
  }

  /**
   * Terminate worker to free up memory
   */
  async close() {
    this.worker?.terminate();
    this.worker = null;
    this.client = null;
    this.file = null;
  }

  /**
   * detect if archive has encrypted data
   * @returns {boolean|null} null if could not be determined
   */
  async hasEncryptedData(): Promise<boolean | null> {
    return await this.client.hasEncryptedData();
  }

  /**
   * set password to be used when reading archive
   */
  async usePassword(archivePassword: string) {
    await this.client.usePassword(archivePassword);
  }

  /**
   * Set locale, defaults to en_US.UTF-8
   */
  async setLocale(locale: string) {
    await this.client.setLocale(locale);
  }

  /**
   * Returns object containing directory structure and file information
   * @returns {Promise<object>}
   */
  async getFilesObject(): Promise<any> {
    if (this._processed > 0) {
      return Promise.resolve().then(() => this._content);
    }
    const files = await this.client.listFiles();

    files.forEach((entry: ArchiveEntry) => {
      const [target, prop] = getObjectPropReference(this._content, entry.path);
      if (entry.type === "FILE") {
        target[prop] = new CompressedFile(
          entry.fileName,
          entry.size,
          entry.path,
          entry.lastModified,
          this,
        );
      }
    });

    this._processed = 1;
    return cloneContent(this._content);
  }

  getFilesArray(): Promise<any[]> {
    return this.getFilesObject().then((obj) => {
      return objectToArray(obj);
    });
  }

  /**
   * Streams a single entry's data. The entry is decompressed a chunk at a time
   * and never held in wasm memory in full, so entries larger than the wasm heap
   * can be read. Reading the stream slowly pauses the worker rather than
   * buffering without bound.
   */
  streamSingleFile(
    target: string,
    options: { chunkSize?: number } = {},
  ): ReadableStream<Uint8Array> {
    if (this.worker === null) {
      throw new Error("Archive already closed");
    }

    let releasePull: (() => void) | null = null;
    // Set when a pull arrives while the worker isn't parked — enqueue can satisfy
    // a pending read and trigger `pull` synchronously, before there is anything
    // to release. Without this the next chunk would wait for a pull that already
    // happened.
    let pullPending = false;
    let cancelled = false;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const onChunk = Comlink.proxy(async (chunk: Uint8Array) => {
          if (cancelled) return false;
          controller.enqueue(chunk);
          // Hold the worker here while the consumer is behind; `pull` releases it.
          if ((controller.desiredSize ?? 1) <= 0 && !pullPending) {
            await new Promise<void>((resolve) => {
              releasePull = resolve;
            });
          }
          pullPending = false;
          return !cancelled;
        });

        this.client
          .streamSingleFile(target, onChunk, options.chunkSize)
          .then(() => {
            if (!cancelled) controller.close();
          })
          .catch((err: any) => {
            if (!cancelled) controller.error(err);
          });
      },
      pull: () => {
        if (releasePull) {
          releasePull();
          releasePull = null;
        } else {
          pullPending = true;
        }
      },
      cancel: () => {
        // Unblock the worker so it observes the cancellation and stops reading.
        cancelled = true;
        releasePull?.();
        releasePull = null;
      },
    });
  }

  async extractSingleFile(target: string): Promise<File> {
    // Prevent extraction if worker already terminated
    if (this.worker === null) {
      throw new Error("Archive already closed");
    }

    // Collected as chunks and handed to the File constructor as separate parts:
    // the browser backs a large Blob with disk storage, whereas the previous
    // single-buffer transfer had to fit the whole entry in memory twice.
    const chunks: Uint8Array[] = [];
    const entry = await this.client.streamSingleFile(
      target,
      Comlink.proxy((chunk: Uint8Array) => {
        chunks.push(chunk);
      }),
    );

    return new File(chunks, entry.fileName, {
      type: "application/octet-stream",
      lastModified: entry.lastModified / 1_000_000,
    });
  }

  /**
   * Returns object containing directory structure and extracted File objects
   * @param {Function} extractCallback
   *
   */
  async extractFiles(
    extractCallback: Function | undefined = undefined,
  ): Promise<any> {
    if (this._processed > 1) {
      return Promise.resolve().then(() => this._content);
    }
    const files = await this.client.extractFiles();

    files.forEach((entry: ArchiveEntry) => {
      const [target, prop] = getObjectPropReference(this._content, entry.path);
      if (entry.type === "FILE") {
        target[prop] = new File([entry.fileData], entry.fileName, {
          type: "application/octet-stream",
        });
        if (extractCallback !== undefined) {
          setTimeout(
            extractCallback.bind(null, {
              file: target[prop],
              path: entry.path,
            }),
          );
        }
      }
    });

    this._processed = 2;
    this.worker?.terminate();
    return cloneContent(this._content);
  }
}
