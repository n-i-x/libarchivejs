/* eslint-disable no-undef */
// Regression test for a read that cannot deliver the entry's declared size.
//
// get_filedata used to return a negative libarchive status cast to a pointer.
// The caller checked `ptr < 0`, which is never true for an unsigned pointer, so
// a failed read went undetected and the "extracted" file was whatever the wasm
// heap held at that address — an entry of exactly the right length, wrong
// contents, no error. It leaked the buffer too.
//
// A zip truncated mid-entry is the cheapest way to make the read fail. Note
// libarchive rejects this outright rather than reporting a clean end-of-entry;
// the separate short-read path (where a reader signals EOF early, as RAR is
// reported to) is covered by the chunked loop in _readWholeEntry but is not
// reproducible from a synthetic zip.
import { Archive } from "../dist/libarchive-node.mjs";
import { Blob } from "buffer";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const NAME = "short.bin";
const DECLARED = 8192;
const PRESENT = 4096;
// A byte value that is unlikely to appear by accident in leftover heap.
const FILL = 0xa7;

function truncatedZip() {
  const full = Buffer.alloc(DECLARED, FILL);
  const nameBuf = Buffer.from(NAME, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(0, 8); // stored
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(0x2821, 12);
  head.writeUInt32LE(crc32(full), 14);
  head.writeUInt32LE(DECLARED, 18);
  head.writeUInt32LE(DECLARED, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28);
  // Header claims DECLARED bytes; the file stops after PRESENT of them and has
  // no central directory, so the reader hits EOF part-way through the entry.
  return Buffer.concat([head, nameBuf, full.subarray(0, PRESENT)]);
}

describe("Entries whose data cannot be fully read", () => {
  test("raises the read error instead of handing back heap contents", async () => {
    const archive = await Archive.open(new Blob([truncatedZip()]));

    // Before the fix this resolved, and the resulting File was DECLARED bytes
    // of heap memory. It must now fail loudly.
    await expect(archive.extractFiles()).rejects.toThrow(/truncated/i);

    await archive.close();
  }, 20000);
});
