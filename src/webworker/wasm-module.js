/* eslint-disable no-undef */
import libarchive from "./wasm-gen/libarchive.js";

export class WasmModule {
  constructor() {
    this.preRun = [];
    this.postRun = [];
    this.totalDependencies = 0;
  }

  print(...text) {
    console.log(text);
  }

  printErr(...text) {
    console.error(text);
  }

  // The wasm sits next to this worker bundle and is fetched by URL, so a
  // deployment that cache-busts the worker (a `?v=` query, say) would otherwise
  // still get whatever libarchive.wasm the browser had cached. A fresh worker
  // paired with a stale wasm is worse than both being stale — it calls exports
  // that don't exist yet. Carry the worker's own query across to the wasm so the
  // two are always fetched as a matched pair.
  locateFile(path, prefix) {
    let search = "";
    try {
      search = new URL(import.meta.url).search;
    } catch {
      // No module URL (bundled to CJS, or running under node) — nothing to carry.
    }
    return `${prefix}${path}${search}`;
  }

  initFunctions() {
    this.runCode = {
      // const char * get_version()
      getVersion: this.cwrap("get_version", "string", []),
      // void * void* archive_open( const void *buf, size_t size, const char * passphrase, const char * locale)
      // retuns archive pointer
      openArchive: this.cwrap("archive_open", "number", [
        "number",
        "number",
        "string",
        "string",
      ]),
      // void * archive_open_file( const char * path, const char * passphrase, const char * locale )
      // Opens an archive from the emscripten filesystem (seekable, read lazily)
      // rather than from a heap buffer. Returns archive pointer.
      openArchiveFile: this.cwrap("archive_open_file", "number", [
        "string",
        "string",
        "string",
      ]),
      // void * get_entry(void * archive)
      // return archive entry pointer
      getNextEntry: this.cwrap("get_next_entry", "number", ["number"]),
      // int read_next_entry(void *archive, void **entry)
      // Returns libarchive's status separately so EOF is distinguishable from
      // a corrupt header or incorrect metadata password.
      readNextEntry: this.cwrap("read_next_entry", "number", [
        "number",
        "number",
      ]),
      // void * get_filedata( void * archive, size_t bufferSize )
      getFileData: this.cwrap("get_filedata", "number", ["number", "number"]),
      // int read_data_chunk( void * archive, void * buff, size_t buffsize )
      // bytes read, 0 at end of entry, negative on error
      readDataChunk: this.cwrap("read_data_chunk", "number", [
        "number",
        "number",
        "number",
      ]),
      // int archive_read_data_skip(struct archive *_a)
      skipEntry: this.cwrap("archive_read_data_skip", "number", ["number"]),
      // void archive_close( void * archive )
      closeArchive: this.cwrap("archive_close", null, ["number"]),
      // double get_entry_size( const void * entry )
      // Wraps archive_entry_size, whose la_int64_t return would be truncated to
      // 32 bits by cwrap's "number" — entries above 2GB came back as garbage.
      getEntrySize: this.cwrap("get_entry_size", "number", ["number"]),
      // const char * archive_entry_pathname_utf8( struct archive_entry * )
      getEntryName: this.cwrap("archive_entry_pathname", "string", ["number"]),
      // __LA_MODE_T archive_entry_filetype( struct archive_entry * )
      /*
            #define AE_IFMT		((__LA_MODE_T)0170000)
            #define AE_IFREG	((__LA_MODE_T)0100000) // Regular file
            #define AE_IFLNK	((__LA_MODE_T)0120000) // Sybolic link
            #define AE_IFSOCK	((__LA_MODE_T)0140000) // Socket
            #define AE_IFCHR	((__LA_MODE_T)0020000) // Character device
            #define AE_IFBLK	((__LA_MODE_T)0060000) // Block device
            #define AE_IFDIR	((__LA_MODE_T)0040000) // Directory
            #define AE_IFIFO	((__LA_MODE_T)0010000) // Named pipe
            */
      getEntryType: this.cwrap("archive_entry_filetype", "number", ["number"]),
      // long		 archive_entry_mtime_nsec(struct archive_entry *);
      getEntryLastModified: this.cwrap("archive_entry_mtime_nsec", "number", [
        "number",
      ]),

      // const char * archive_error_string(struct archive *);
      getError: this.cwrap("archive_error_string", "string", ["number"]),

      // void *start_archive_write(char *filter, char *format, void *buff, size_t buffsize, size_t *outputsize, char *passphrase)
      startArchiveWrite: this.cwrap("start_archive_write", "number", [
        "string",
        "string",
        "number",
        "number",
        "number",
        "string",
      ]),

      // void write_archive_file( void *a, char *pathname, size_t filesize , char *filedata )
      writeArchiveFile: this.cwrap("write_archive_file", null, [
        "number",
        "string",
        "number",
        "number",
      ]),

      // int finish_archive_write(void *a, size_t *outputsize)
      finishArchiveWrite: this.cwrap("finish_archive_write", "number", [
        "number",
        "number",
      ]),

      /*
       * Returns 1 if the archive contains at least one encrypted entry.
       * If the archive format not support encryption at all
       * ARCHIVE_READ_FORMAT_ENCRYPTION_UNSUPPORTED is returned.
       * If for any other reason (e.g. not enough data read so far)
       * we cannot say whether there are encrypted entries, then
       * ARCHIVE_READ_FORMAT_ENCRYPTION_DONT_KNOW is returned.
       * In general, this function will return values below zero when the
       * reader is uncertain or totally incapable of encryption support.
       * When this function returns 0 you can be sure that the reader
       * supports encryption detection but no encrypted entries have
       * been found yet.
       *
       * NOTE: If the metadata/header of an archive is also encrypted, you
       * cannot rely on the number of encrypted entries. That is why this
       * function does not return the number of encrypted entries but#
       * just shows that there are some.
       */
      // __LA_DECL int	archive_read_has_encrypted_entries(struct archive *);
      entryIsEncrypted: this.cwrap("archive_entry_is_encrypted", "number", [
        "number",
      ]),
      hasEncryptedEntries: this.cwrap(
        "archive_read_has_encrypted_entries",
        "number",
        ["number"],
      ),
      // __LA_DECL int archive_read_add_passphrase(struct archive *, const char *);
      addPassphrase: this.cwrap("archive_read_add_passphrase", "number", [
        "number",
        "string",
      ]),
      // allocate()/intArrayFromString() were removed from the emscripten runtime
      // in 3.1.44; stringToNewUTF8 is the supported equivalent (mallocs, caller frees).
      string: (str) => this.stringToNewUTF8(str),
      malloc: this.cwrap("malloc", "number", ["number"]),
      free: this.cwrap("free", null, ["number"]),
      sizeOfSizeT: this.cwrap("size_of_size_t", "number", []),
    };
  }

  monitorRunDependencies() {}
}

export function getWasmModule(cb) {
  libarchive(new WasmModule()).then((module) => {
    module.initFunctions();
    cb(module);
  });
}
