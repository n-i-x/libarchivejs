/* eslint-disable no-undef */
import { checksum } from "../checksum.js";
import {
  navigate,
  inputFile,
  response,
  setup,
  cleanup,
} from "../testutils.mjs";

let browser, page;

beforeAll(async () => {
  let tmp = await setup();
  browser = tmp.browser;
  page = tmp.page;
});

describe("Extract RAR files", () => {
  test("Extract RAR v4", async () => {
    await navigate(page);
    await inputFile("archives/rar/test-v4.rar", page);
    const files = await response(page);
    expect(files).toEqual(checksum);
  }, 16000);
  test("Extract RAR v5", async () => {
    await navigate(page);
    await inputFile("archives/rar/test-v5.rar", page);
    const files = await response(page);
    expect(files).toEqual(checksum);
  }, 16000);
  test("Extract password-protected RAR4 with encrypted headers", async () => {
    await navigate(page, "encryption.html?password=rar4-hp-secret");
    await inputFile("archives/rar/encrypted-headers-v4.rar", page);
    const { files, encrypted } = await response(page);
    expect(encrypted).toBe(true);
    expect(files).toEqual({
      "hidden-message.txt":
        "a9860f0761847e672a7ff5d5765f40ec442117a88c8b45d91c9dd59c993b414c",
      "hidden-pattern.bin":
        "8f1e5639867efc9161bd2ee5634b6d120db21192c8fb43996016ff9b91444de4",
    });
  }, 30000);
});

afterAll(() => {
  cleanup(browser);
});
