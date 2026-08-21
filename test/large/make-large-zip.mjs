// Generates a ZIP whose payload entry is larger than 2GB, to cover the case
// where the archive cannot be held in wasm memory at all.
//
// Written by hand rather than with an external archiver so the test suite needs
// no 7z/zip binary. Everything is STORED (method 0): the point is the size of
// the data, and deflating gigabytes would only make the test slow. A small entry
// is placed after the big one so the reader also has to find a local header at
// an offset past 2^31 — the case that used to be silently truncated.
//
// The file is deliberately not committed; CI regenerates it on demand.
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf, seed = 0) {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

// One megabyte of non-uniform bytes, repeated. Deterministic so the expected
// CRC is reproducible, and varied enough that a truncated or misaligned read
// changes it.
export function patternBlock() {
  const block = Buffer.allocUnsafe(1024 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = (i * 31 + (i >> 13)) & 0xff;
  return block;
}

function localHeader(name, crc, size) {
  const nameBuf = Buffer.from(name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0, 6); // flags
  head.writeUInt16LE(0, 8); // method: stored
  head.writeUInt16LE(0, 10); // time
  head.writeUInt16LE(0x2821, 12); // date (2000-01-01)
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(size, 18); // compressed size
  head.writeUInt32LE(size, 22); // uncompressed size
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([head, nameBuf]);
}

function centralHeader(name, crc, size, offset) {
  const nameBuf = Buffer.from(name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0, 8); // flags
  head.writeUInt16LE(0, 10); // method: stored
  head.writeUInt16LE(0, 12); // time
  head.writeUInt16LE(0x2821, 14); // date
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(size, 20);
  head.writeUInt32LE(size, 24);
  head.writeUInt16LE(nameBuf.length, 28);
  head.writeUInt16LE(0, 30); // extra length
  head.writeUInt16LE(0, 32); // comment length
  head.writeUInt16LE(0, 34); // disk number
  head.writeUInt16LE(0, 36); // internal attrs
  head.writeUInt32LE(0, 38); // external attrs
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, nameBuf]);
}

function endOfCentralDirectory(count, cdSize, cdOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

export const LARGE_ENTRY_NAME = "large.bin";
export const TRAILING_ENTRY_NAME = "after.txt";
export const TRAILING_ENTRY_TEXT = "entry stored past the 2GB mark\n";

/**
 * Writes the fixture if it isn't already present.
 * @param {string} outPath
 * @param {number} sizeBytes size of the large entry (default 2.5GB)
 * @returns {Promise<{path: string, size: number, crc: number, trailingCrc: number}>}
 */
export async function makeLargeZip(outPath, sizeBytes = 2_684_354_560) {
  const block = patternBlock();
  const blocks = Math.ceil(sizeBytes / block.length);
  const size = blocks * block.length;

  // Precompute the CRC of the large entry — the local header has to carry it,
  // and a stored entry gives no chance to backfill without a data descriptor.
  let crc = 0;
  for (let i = 0; i < blocks; i++) crc = crc32(block, crc);

  const trailing = Buffer.from(TRAILING_ENTRY_TEXT, "utf8");
  const trailingCrc = crc32(trailing);

  const existing = await stat(outPath).catch(() => null);
  const largeHeader = localHeader(LARGE_ENTRY_NAME, crc, size);
  const trailingHeader = localHeader(
    TRAILING_ENTRY_NAME,
    trailingCrc,
    trailing.length,
  );
  const largeOffset = 0;
  const trailingOffset = largeHeader.length + size;
  const central = Buffer.concat([
    centralHeader(LARGE_ENTRY_NAME, crc, size, largeOffset),
    centralHeader(
      TRAILING_ENTRY_NAME,
      trailingCrc,
      trailing.length,
      trailingOffset,
    ),
  ]);
  const cdOffset = trailingOffset + trailingHeader.length + trailing.length;
  const expectedTotal = cdOffset + central.length + 22;

  if (existing && existing.size === expectedTotal) {
    return { path: outPath, size, crc, trailingCrc };
  }

  await mkdir(dirname(outPath), { recursive: true });

  async function* content() {
    yield largeHeader;
    for (let i = 0; i < blocks; i++) yield block;
    yield trailingHeader;
    yield trailing;
    yield central;
    yield endOfCentralDirectory(2, central.length, cdOffset);
  }

  await pipeline(Readable.from(content()), createWriteStream(outPath));
  return { path: outPath, size, crc, trailingCrc };
}

// Allow running directly: node test/large/make-large-zip.mjs [sizeBytes]
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(process.cwd(), "test/files/archives/large.zip");
  const size = process.argv[2] ? Number(process.argv[2]) : undefined;
  const result = await makeLargeZip(out, size);
  console.log(JSON.stringify(result, null, 2));
}
