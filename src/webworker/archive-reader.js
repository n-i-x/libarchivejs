const TYPE_MAP = {
  32768: "FILE",
  16384: "DIR",
  40960: "SYMBOLIC_LINK",
  49152: "SOCKET",
  8192: "CHARACTER_DEVICE",
  24576: "BLOCK_DEVICE",
  4096: "NAMED_PIPE",
};

// Where the input archive is mounted inside the emscripten filesystem.
const MOUNT_POINT = "/libarchivejs";

// Size of the bounce buffer used to stream an entry out of wasm memory. This is
// the only entry-proportional allocation left in the read path, so it bounds
// peak heap use regardless of how large the entry is.
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

const ARCHIVE_OK = 0;
const ARCHIVE_EOF = 1;
const ARCHIVE_WARN = -20;

// WORKERFS reads Blob slices synchronously via FileReaderSync, which only exists
// inside a worker. Everywhere else (node, or a wasm build without the FS shipped)
// we fall back to loading the archive into the heap as before.
function canMountFile(wasmModule, file) {
  return !!(
    wasmModule.FS &&
    wasmModule.WORKERFS &&
    typeof FileReaderSync !== "undefined" &&
    file &&
    typeof file.slice === "function"
  );
}

// The mounted name is only a handle for libarchive to open; keep the original
// basename (some readers use it, e.g. multi-volume detection) but strip anything
// that would turn it into a path.
function mountName(file) {
  const raw = (file && file.name) || "archive";
  const base = raw.split(/[/\\]/).pop();
  return base && base !== "." && base !== ".." ? base : "archive";
}

export class ArchiveReader {
  /**
   * Archive reader
   * @param {WasmModule} wasmModule emscripten module
   */
  constructor(wasmModule) {
    this._wasmModule = wasmModule;
    this._runCode = wasmModule.runCode;
    this._file = null;
    this._passphrase = null;
    this._locale = "en_US.UTF-8";
    this._archive = null;
    this._filePtr = null;
    this._fileLength = 0;
    this._mountedPath = null;
  }

  /**
   * Open archive, needs to closed manually
   * @param {File} file
   */
  async open(file) {
    if (this._file !== null) {
      console.warn("Closing previous file");
      this.close();
    }
    this._file = file;

    if (canMountFile(this._wasmModule, file)) {
      // Lazy path: libarchive reads the file through the filesystem, so only the
      // blocks it actually needs are ever pulled into memory. This is what lets
      // archives larger than the wasm heap be opened at all.
      this._mountedPath = this._mountFile(file);
    } else {
      const fileData = await this._loadFile(file);
      this._fileLength = fileData.length;
      this._filePtr = fileData.ptr;
    }
  }

  /**
   * Close archive
   */
  close() {
    this._closeArchive();

    if (this._mountedPath !== null) {
      try {
        this._wasmModule.FS.unmount(MOUNT_POINT);
      } catch (e) {
        console.warn("Failed to unmount archive", e);
      }
      this._mountedPath = null;
    }

    if (this._filePtr !== null) {
      this._wasmModule._free(this._filePtr);
      this._filePtr = null;
      this._fileLength = 0;
    }

    this._file = null;
  }

  /**
   * Detect if archive has encrypted data
   * @returns {boolean|null} null if could not be determined
   */
  hasEncryptedData() {
    const archive = this._openArchive();
    let headerError = null;
    try {
      this._nextEntry(archive);
    } catch (error) {
      headerError = error;
    }
    const status = this._runCode.hasEncryptedEntries(archive);
    if (status === 0) {
      if (headerError !== null) throw headerError;
      return false;
    } else if (status > 0) {
      return true;
    } else {
      if (headerError !== null) throw headerError;
      return null;
    }
  }

  /**
   * set passphrase to be used with archive
   * @param {string} passphrase
   */
  setPassphrase(passphrase) {
    this._passphrase = passphrase;
  }

  /**
   * Set locale, defaults to: en_US.UTF-8
   * @param {string} locale
   */
  setLocale(locale) {
    this._locale = locale;
  }

  /**
   * Get archive entries
   * @param {boolean} skipExtraction
   * @param {string} except don't skip extraction for this entry
   */
  *entries(skipExtraction = false, except = null) {
    const archive = this._openArchive();
    let entry;
    while (true) {
      entry = this._nextEntry(archive);
      if (entry === 0) break;

      const entryData = this._entryData(entry);

      if (skipExtraction && except !== entryData.path) {
        this._runCode.skipEntry(archive);
      } else {
        entryData.fileData = this._readWholeEntry(archive, entryData.size);
      }
      yield entryData;
    }
  }

  /**
   * Stream a single entry's data out in chunks, without ever holding the whole
   * entry in memory. onChunk receives a Uint8Array and may return false (or a
   * promise resolving to false) to stop early.
   * @param {string} target entry path
   * @param {Function} onChunk
   * @param {number} chunkSize
   * @returns {Promise<object>} the entry's metadata
   */
  async streamEntry(target, onChunk, chunkSize = DEFAULT_CHUNK_SIZE) {
    const archive = this._openArchive();

    let meta = null;
    let entry;
    while ((entry = this._nextEntry(archive)) !== 0) {
      const path = this._runCode.getEntryName(entry);
      if (path !== target) {
        this._runCode.skipEntry(archive);
        continue;
      }
      meta = this._entryData(entry);
      break;
    }

    if (meta === null) {
      throw new Error(`Entry not found in archive: ${target}`);
    }

    const buff = this._runCode.malloc(chunkSize);
    if (buff === 0) {
      throw new Error(`Failed to allocate a ${chunkSize} byte read buffer`);
    }

    try {
      for (;;) {
        const read = this._runCode.readDataChunk(archive, buff, chunkSize);
        if (read === 0) break;
        if (read < 0) {
          throw new Error(
            this._runCode.getError(archive) || "Error reading entry data",
          );
        }
        // Re-read HEAPU8 every pass: the heap can be replaced by memory growth,
        // which detaches any view held across the call.
        const chunk = this._wasmModule.HEAPU8.slice(buff, buff + read);
        const proceed = await onChunk(chunk);
        if (proceed === false) break;
      }
    } finally {
      this._runCode.free(buff);
    }

    return meta;
  }

  _entryData(entry) {
    const entryData = {
      size: this._runCode.getEntrySize(entry),
      path: this._runCode.getEntryName(entry),
      type: TYPE_MAP[this._runCode.getEntryType(entry)],
      lastModified: this._runCode.getEntryLastModified(entry),
      ref: entry,
    };

    if (entryData.type === "FILE") {
      const fileName = entryData.path.split("/");
      entryData.fileName = fileName[fileName.length - 1];
    }

    return entryData;
  }

  _nextEntry(archive) {
    const entryOut = this._runCode.malloc(this._runCode.sizeOfSizeT());
    if (entryOut === 0) {
      throw new Error("Failed to allocate archive entry pointer");
    }
    try {
      const status = this._runCode.readNextEntry(archive, entryOut);
      const entry = this._wasmModule.HEAPU32[entryOut >>> 2];

      if (status === ARCHIVE_OK || (status === ARCHIVE_WARN && entry !== 0)) {
        return entry;
      }
      if (status === ARCHIVE_EOF) {
        return 0;
      }
      throw new Error(
        this._runCode.getError(archive) ||
          `Error reading archive header (${status})`,
      );
    } finally {
      this._runCode.free(entryOut);
    }
  }

  // Reads an entry in full, a chunk at a time. Chunking matters for more than
  // memory: archive_read_data returns what it has to hand, which for some
  // formats (notably RAR) is a single decompressed block, so a one-shot read
  // yields an entry of the right length whose tail was never written. Looping
  // is also what makes the true decoded length knowable.
  _readWholeEntry(archive, size) {
    if (size === 0) {
      return new Uint8Array(0);
    }

    const chunkSize = Math.min(size, DEFAULT_CHUNK_SIZE);
    const buff = this._runCode.malloc(chunkSize);
    if (buff === 0) {
      throw new Error(`Failed to allocate a ${chunkSize} byte read buffer`);
    }

    const out = new Uint8Array(size);
    let total = 0;
    try {
      while (total < size) {
        const want = Math.min(chunkSize, size - total);
        const read = this._runCode.readDataChunk(archive, buff, want);
        if (read < 0) {
          throw new Error(
            this._runCode.getError(archive) || "Error reading entry data",
          );
        }
        if (read === 0) break;
        // Re-read HEAPU8 each pass: memory growth can replace the buffer and
        // detach any view held across the call.
        out.set(this._wasmModule.HEAPU8.subarray(buff, buff + read), total);
        total += read;
      }
    } finally {
      this._runCode.free(buff);
    }

    // A short read means the entry ended early; report what was actually
    // decoded rather than padding it out to the declared size.
    return total === size ? out : out.subarray(0, total);
  }

  // Opens (or re-opens) the archive. Listing and extracting each start a fresh
  // read, so the previous handle has to be released first — otherwise every pass
  // leaks an archive struct and, on the mounted path, a file descriptor.
  _openArchive() {
    this._closeArchive();

    this._archive =
      this._mountedPath !== null
        ? this._runCode.openArchiveFile(
            this._mountedPath,
            this._passphrase,
            this._locale,
          )
        : this._runCode.openArchive(
            this._filePtr,
            this._fileLength,
            this._passphrase,
            this._locale,
          );

    return this._archive;
  }

  _closeArchive() {
    if (this._archive !== null) {
      this._runCode.closeArchive(this._archive);
      this._archive = null;
    }
  }

  _mountFile(file) {
    const FS = this._wasmModule.FS;
    try {
      FS.mkdir(MOUNT_POINT);
    } catch (e) {
      // Already present from a previous open in this worker.
    }
    const name = mountName(file);
    // `blobs` rather than `files` so a plain Blob (no name) works too.
    FS.mount(
      this._wasmModule.WORKERFS,
      { blobs: [{ name, data: file }] },
      MOUNT_POINT,
    );
    return `${MOUNT_POINT}/${name}`;
  }

  async _loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const array = new Uint8Array(arrayBuffer);
    const filePtr = this._runCode.malloc(array.length);
    if (filePtr === 0) {
      throw new Error(
        `Failed to allocate ${array.length} bytes for the archive; ` +
          `the file is too large to load into memory`,
      );
    }
    this._wasmModule.HEAPU8.set(array, filePtr);
    return {
      ptr: filePtr,
      length: array.length,
    };
  }
}
