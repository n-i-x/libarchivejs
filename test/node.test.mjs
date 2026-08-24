import {
  Archive,
  ArchiveCompression,
  ArchiveFormat,
} from "../dist/libarchive-node.mjs";
import fs from "fs";
import { Blob } from "buffer";
import { fileChecksums, getChecksum } from "./checksum-utils";
import { checksum } from "./checksum";

describe("Extract file using nodejs", () => {
  test("Extract 7z file", async () => {
    let buffer = fs.readFileSync("test/files/archives/test.7z");
    let blob = new Blob([buffer]);

    const archive = await Archive.open(blob);
    const filesObj = await archive.extractFiles();

    const checksumObj = await fileChecksums(filesObj);
    expect(checksumObj).toEqual(checksum);
    archive.close();
  }, 5000);

  test("Extract password-protected RAR5 compressed data", async () => {
    const buffer = fs.readFileSync(
      "test/files/archives/rar/encrypted-v5-compressed.rar",
    );
    const archive = await Archive.open(new Blob([buffer]));

    await archive.usePassword("secret");
    const checksumObj = await fileChecksums(await archive.extractFiles());

    expect(checksumObj).toEqual({
      "libarchive.wasm":
        "8a335241c13de819f3d6d77bc87212e9b14f9300334dfbb604a6c057924525d6",
      "readme.md": checksum["README.md"],
    });
    await archive.close();
  }, 30000);

  test("Extract password-protected RAR5 stored data", async () => {
    const buffer = fs.readFileSync(
      "test/files/archives/rar/encrypted-v5-stored.rar",
    );
    const archive = await Archive.open(new Blob([buffer]));

    await archive.usePassword("secret");
    const checksumObj = await fileChecksums(await archive.extractFiles());

    expect(checksumObj["README.md"]).toEqual(checksum["README.md"]);
    await archive.close();
  }, 30000);

  test("Extract password-protected RAR4 data", async () => {
    const buffer = fs.readFileSync(
      "test/files/archives/rar/encrypted-v4.rar",
    );
    const archive = await Archive.open(new Blob([buffer]));

    await archive.usePassword("rar4-secret");
    const checksumObj = await fileChecksums(await archive.extractFiles());

    expect(checksumObj).toEqual({
      "message.txt":
        "b1b606b099f2e3270b0924d8eabfaebbd30cd2cdc457d34c5c71176d24ad2370",
      "pattern.bin":
        "6fc179cfd193754e6109ad043f56d146c7e7d7c3623ffceae318266286f58388",
    });
    await archive.close();
  }, 30000);

  test("Reject an incorrect RAR5 password", async () => {
    const buffer = fs.readFileSync(
      "test/files/archives/rar/encrypted-v5-stored.rar",
    );
    const archive = await Archive.open(new Blob([buffer]));

    await archive.usePassword("wrong");
    await expect(archive.extractFiles()).rejects.toThrow(/checksum/i);
    await archive.close();
  }, 30000);

  test("Extract a selected file from a password-protected solid RAR5", async () => {
    const buffer = fs.readFileSync(
      "test/files/archives/rar/encrypted-v5-solid.rar",
    );
    const archive = await Archive.open(new Blob([buffer]));

    await archive.usePassword("secret");
    const file = await archive.extractSingleFile("second.wasm");

    expect(file.size).toBe(1040104);
    expect(await getChecksum(file)).toBe(
      "4f24a557658b9c01d77b927364382721944999fc46d1387cd49438dd4e158a8a",
    );
    await archive.close();
  }, 30000);

  test("Create new archive", async () => {
    let buffer = fs.readFileSync("test/files/archives/README.md");
    let blob = new Blob([buffer]);

    const archiveFile = await Archive.write({
      files: [
        {
          file: blob,
          pathname: "README.md",
        },
      ],
      outputFileName: "test.tar.gz",
      compression: ArchiveCompression.GZIP,
      format: ArchiveFormat.USTAR,
      passphrase: null,
    });

    const archive = await Archive.open(archiveFile);
    const filesObj = await archive.extractFiles();
    const checksumObj = await fileChecksums(filesObj);
    expect(checksumObj["README.md"]).toEqual(checksum["README.md"]);

    archive.close();
  }, 5000);
});
