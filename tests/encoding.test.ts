import { expect, test, describe, afterAll } from "bun:test";
import { decodeOutput } from "../src/utils";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Encoding Handling", () => {
  const tempLogFile = join(tmpdir(), `test_encoding_${Date.now()}.log`);

  afterAll(() => {
    if (existsSync(tempLogFile)) {
      unlinkSync(tempLogFile);
    }
  });

  test("Decodes UTF-8 Chinese characters", () => {
    // "你好" in UTF-8
    const utf8Bytes = new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]);
    expect(decodeOutput(utf8Bytes)).toBe("你好");
  });

  test("Decodes GBK Chinese characters (fallback)", () => {
    // "你好" in GBK
    const gbkBytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    expect(decodeOutput(gbkBytes)).toBe("你好");
  });

  test("Integration: Process Output -> Log File -> Read Logs", () => {
    // 1. Simulate process outputting GBK (typical on legacy Windows)
    const gbkOutput = new Uint8Array([
      0xc4, 0xe3, 0xba, 0xc3, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64,
    ]); // "你好 World" in GBK

    // 2. Decode it (as pyrunner does)
    const decoded = decodeOutput(gbkOutput);
    expect(decoded).toBe("你好 World");

    // 3. Write to log file (UTF-8 is default in Node/Bun)
    writeFileSync(tempLogFile, decoded);

    // 4. Read back from log file
    const buffer = readFileSync(tempLogFile);
    const content = decodeOutput(buffer);

    expect(content).toBe("你好 World");
  });

  test("Handles empty buffer", () => {
    expect(decodeOutput(new Uint8Array([]))).toBe("");
  });

  test("Decodes ASCII characters correctly", () => {
    const asciiBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    expect(decodeOutput(asciiBytes)).toBe("Hello");
  });

  test("Fallback to non-fatal UTF-8 for completely invalid sequences", () => {
    const invalidBytes = new Uint8Array([0xff, 0xff]);
    const result = decodeOutput(invalidBytes);
    expect(typeof result).toBe("string");
  });
});
