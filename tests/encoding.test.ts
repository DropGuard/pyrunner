import { describe, expect, test } from "bun:test";
import { SmartDecoder } from "../src/utils/process";

const POEM = `
春江潮水连海平，海上明月共潮生。
滟滟随波千万里，何处春江无月明？
...
斜月沉沉藏海雾，碣石潇湘无限路。
不知乘月几人归，落月摇情满江树。`;

describe("Encoding Unit Tests", () => {
  test("SmartDecoder handles UTF-8 correctly", () => {
    const encoder = new TextEncoder();
    const decoder = new SmartDecoder();
    const encoded = encoder.encode(POEM);
    const decoded = decoder.decode(encoded, true);
    expect(decoded).toBe(POEM);
  });

  test("SmartDecoder handles streaming multi-byte characters", () => {
    const encoder = new TextEncoder();
    const decoder = new SmartDecoder();
    const encoded = encoder.encode(POEM);

    // Split in the middle of a multi-byte character
    const chunk1 = encoded.slice(0, 10);
    const chunk2 = encoded.slice(10);

    const part1 = decoder.decode(chunk1);
    const part2 = decoder.decode(chunk2);
    const final = decoder.decode(new Uint8Array(0), true);

    expect(part1 + part2 + final).toBe(POEM);
  });

  test("SmartDecoder replaces invalid bytes with U+FFFD", () => {
    const decoder = new SmartDecoder();
    // Invalid UTF-8 sequence
    const invalid = new Uint8Array([0xff, 0xfe]);
    const result = decoder.decode(invalid, true);
    expect(result).toContain("�");
  });
});
