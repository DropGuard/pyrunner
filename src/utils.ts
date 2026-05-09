import { CronExpressionParser } from "cron-parser";

/**
 * Calculates the next execution time based on a cron expression.
 */
export function calculateNextRun(cron: string, baseTime?: number): number {
  const options = baseTime ? { currentDate: new Date(baseTime) } : {};
  return CronExpressionParser.parse(cron, options).next().getTime();
}

/**
 * Decodes a buffer to string using an intelligent fallback.
 * Checks for valid UTF-8 sequences; if invalid, assumes GBK (common on Windows).
 */
export function decodeOutput(buffer: Uint8Array): string {
  if (buffer.length === 0) return "";

  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8Decoder.decode(buffer);
  } catch (e) {
    try {
      // @ts-expect-error - "gbk" is supported by Bun/Node but might not be in the standard Encoding type
      return new TextDecoder("gbk").decode(buffer);
    } catch (e2) {
      // Last resort fallback
      return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }
  }
}
