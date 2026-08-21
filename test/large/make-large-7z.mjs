// Generates a >2GB 7-Zip archive with the same contents as the large ZIP
// fixture, so both formats can be checked against the same expected CRCs.
//
// 7z matters specifically because its header lives at the end of the file and
// its reader seeks around more than zip's — exactly what a whole-file-in-memory
// reader used to hide. The Copy codec is used so the archive really is larger
// than 2GB (compressing this pattern would collapse it to almost nothing, which
// would only exercise the large-entry path and not the large-input one).
//
// Requires the `7z` binary. Not committed; regenerated on demand.
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  crc32,
  patternBlock,
  LARGE_ENTRY_NAME,
  TRAILING_ENTRY_NAME,
  TRAILING_ENTRY_TEXT,
} from "./make-large-zip.mjs";

const execFileAsync = promisify(execFile);

/**
 * Writes the 7z fixture if it isn't already present.
 * @param {string} outPath
 * @param {number} sizeBytes size of the large entry (default 2.5GB)
 * @returns {Promise<{path: string, size: number, crc: number}>}
 */
export async function makeLarge7z(outPath, sizeBytes = 2_684_354_560) {
  const block = patternBlock();
  const blocks = Math.ceil(sizeBytes / block.length);
  const size = blocks * block.length;

  let crc = 0;
  for (let i = 0; i < blocks; i++) crc = crc32(block, crc);

  // 7z refuses to overwrite in place, and a partial archive from an interrupted
  // run would silently be reused; treat "exists and non-trivial" as done.
  const existing = await stat(outPath).catch(() => null);
  if (existing && existing.size > size) {
    return { path: outPath, size, crc };
  }

  const srcDir = join(dirname(outPath), "large-src");
  await mkdir(srcDir, { recursive: true });

  async function* content() {
    for (let i = 0; i < blocks; i++) yield block;
  }
  await pipeline(
    Readable.from(content()),
    createWriteStream(join(srcDir, LARGE_ENTRY_NAME)),
  );
  await writeFile(join(srcDir, TRAILING_ENTRY_NAME), TRAILING_ENTRY_TEXT);

  await rm(outPath, { force: true });
  // -m0=Copy: store, don't compress. -mhc=off: leave the header uncompressed so
  // the archive layout stays simple to reason about if this ever needs debugging.
  await execFileAsync(
    "7z",
    [
      "a",
      "-t7z",
      "-m0=Copy",
      "-mhc=off",
      "-bso0",
      "-bsp0",
      outPath,
      join(srcDir, LARGE_ENTRY_NAME),
      join(srcDir, TRAILING_ENTRY_NAME),
    ],
    { maxBuffer: 1024 * 1024 },
  );

  // The raw sources are only needed to feed 7z; the archive is what the test uses.
  await rm(srcDir, { recursive: true, force: true });

  return { path: outPath, size, crc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(process.cwd(), "test/files/archives/large.7z");
  const size = process.argv[2] ? Number(process.argv[2]) : undefined;
  console.log(JSON.stringify(await makeLarge7z(out, size), null, 2));
}
