/* eslint-disable no-undef */
// Coverage for archives too large to fit in wasm memory. The fixtures are ~2.7GB
// each, so this is opt-in rather than part of the default run:
//
//   LARGE_FIXTURES=1 npm test -- large
//
// It asserts three things the old whole-file-in-memory reader could not do:
// open an archive bigger than the heap at all, report an entry size above 2^31
// without truncating it, and read an entry whose header sits past the 2GB mark.
//
// Both zip and 7z are covered: 7z keeps its header at the end of the file and
// seeks around more than zip does, which is the case that motivated the fix.
// The 7z fixture needs the `7z` binary; the zip one is written by hand.
import { join } from "node:path";
import {
  navigate,
  inputFile,
  response,
  setup,
  cleanup,
} from "./testutils.mjs";
import { makeLargeZip, TRAILING_ENTRY_TEXT } from "./large/make-large-zip.mjs";
import { makeLarge7z } from "./large/make-large-7z.mjs";

const ENABLED = process.env.LARGE_FIXTURES === "1";

let browser, page;
const fixtures = {};

const describeLarge = ENABLED ? describe : describe.skip;

beforeAll(async () => {
  if (!ENABLED) return;
  // Generating and CRC-ing ~2.7GB twice takes a while; both are cached on disk.
  fixtures.zip = await makeLargeZip(
    join(process.cwd(), "test/files/archives/large.zip"),
  );
  fixtures["7z"] = await makeLarge7z(
    join(process.cwd(), "test/files/archives/large.7z"),
  );
  const tmp = await setup();
  browser = tmp.browser;
  page = tmp.page;
}, 1800000);

describeLarge("Archives larger than the wasm heap", () => {
  test.each([
    ["zip", "archives/large.zip"],
    ["7z", "archives/large.7z"],
  ])(
    "%s: streams a >2GB entry and reads past the 2GB mark",
    async (format, path) => {
      const expected = fixtures[format];

      await navigate(page, "large.html");
      await inputFile(path, page);
      const result = await response(page);

      expect(result).not.toBeNull();
      expect(result.error).toBeUndefined();

      // Size survives the JS boundary: this is above 2^31, which the previous
      // 32-bit cwrap return truncated.
      expect(result.listedSize).toBe(expected.size);
      expect(result.streamedSize).toBe(expected.size);

      // Bytes are correct, not merely the right length.
      expect(result.crc).toBe(expected.crc);

      // Streaming really was chunked rather than one giant buffer.
      expect(result.maxChunk).toBeLessThanOrEqual(4 * 1024 * 1024);

      // The small entry stored alongside the big one is still reachable.
      expect(result.afterText).toBe(TRAILING_ENTRY_TEXT);
      expect(result.afterSize).toBe(
        Buffer.byteLength(TRAILING_ENTRY_TEXT, "utf8"),
      );
    },
    900000,
  );
});

afterAll(() => {
  if (browser) cleanup(browser);
});
