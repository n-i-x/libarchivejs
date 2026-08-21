import * as Comlink from "comlink/dist/esm/comlink.mjs";
import { ArchiveReader } from "./archive-reader";
import { ArchiveWriter } from "./archive-writer";
import { getWasmModule } from "./wasm-module";

let reader = null;
let writer = null;
let ready = false;

export class LibArchiveWorker {
  constructor(readyCallback) {
    LibArchiveWorker.readyCallback = readyCallback;
    if (ready) {
      setTimeout(() => readyCallback(), 0);
    }
  }

  open(file, cb) {
    reader.open(file).then(() => cb());
  }

  listFiles() {
    let arr = [];
    for (const entry of reader.entries(true)) {
      arr.push(entry);
    }
    return arr;
  }

  extractFiles() {
    let arr = [];
    for (const entry of reader.entries(false)) {
      arr.push(entry);
    }
    return arr;
  }

  extractSingleFile(target) {
    for (const entry of reader.entries(true, target)) {
      if (entry.fileData) {
        return entry;
      }
    }
  }

  /**
   * Streams one entry's data to the caller a chunk at a time. Each chunk's
   * buffer is transferred rather than copied, and the callback's resolution
   * paces the read, so the consumer can apply backpressure.
   * Resolves to the entry's metadata once the entry has been fully read.
   */
  streamSingleFile(target, onChunk, chunkSize) {
    return reader.streamEntry(
      target,
      (chunk) => onChunk(Comlink.transfer(chunk, [chunk.buffer])),
      chunkSize,
    );
  }

  hasEncryptedData() {
    return reader.hasEncryptedData();
  }

  usePassword(passphrase) {
    reader.setPassphrase(passphrase);
  }

  setLocale(locale) {
    reader.setLocale(locale);
  }

  writeArchive(files, compression, format, passphrase) {
    return writer.write(files, compression, format, passphrase);
  }

  close() {
    reader.close();
  }
}

getWasmModule((wasmModule) => {
  reader = new ArchiveReader(wasmModule);
  writer = new ArchiveWriter(wasmModule);
  LibArchiveWorker?.readyCallback?.();
  ready = true;
});
