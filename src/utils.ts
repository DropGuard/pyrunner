import { CronExpressionParser } from "cron-parser";
import { $ } from "bun";

/**
 * Calculates the next execution time based on a cron expression.
 */
export function calculateNextRun(cron: string, baseTime?: number): number {
  const options = baseTime ? { currentDate: new Date(baseTime) } : {};
  return CronExpressionParser.parse(cron, options).next().getTime();
}

export const logger = {
  info: (msg: string) => console.log(`[\x1b[36m${new Date().toLocaleString()}\x1b[0m] ${msg}`),
  warn: (msg: string) => console.warn(`[\x1b[33m${new Date().toLocaleString()}\x1b[0m] [WARN] ${msg}`),
  error: (msg: string, err?: any) => {
    console.error(`[\x1b[31m${new Date().toLocaleString()}\x1b[0m] [ERROR] ${msg}`, err ?? "");
  },
  success: (msg: string) => console.log(`[\x1b[32m${new Date().toLocaleString()}\x1b[0m] [OK] ${msg}`),
};

/**
 * Safely kills a process and its children.
 */
export async function killProcessTree(pid: number) {
  try {
    if (process.platform === "win32") {
      await $`taskkill /F /T /PID ${pid}`.quiet().nothrow();
    } else {
      try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
      setTimeout(() => {
        try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
      }, 2000);
    }
  } catch (e) {}
}

/**
 * Windows-specific: Force UTF-8 console output code page via Win32 API
 */
export function setupWindowsEncoding() {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      SetConsoleOutputCP: { args: [FFIType.u32], returns: FFIType.i32 },
    });
    kernel32.symbols.SetConsoleOutputCP(65001);
    kernel32.close();
  } catch {
    try {
      Bun.spawnSync(["cmd", "/c", "chcp", "65001"], { stdout: "ignore", stderr: "ignore" });
    } catch {}
  }
}

/**
 * Windows-specific: Hide the current console window
 */
export function hideConsole() {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      GetConsoleWindow: { args: [], returns: FFIType.pointer },
    });
    const user32 = dlopen("user32.dll", {
      ShowWindow: { args: [FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
    });

    const hwnd = kernel32.symbols.GetConsoleWindow();
    if (hwnd) {
      user32.symbols.ShowWindow(hwnd, 0); // 0 = SW_HIDE
    }
    kernel32.close();
    user32.close();
  } catch {}
}

/**
 * A robust UTF-8 decoder that sanitizes output.
 * It will replace invalid bytes with the replacement character (U+FFFD) 
 * instead of crashing, ensuring that the resulting string is ALWAYS valid UTF-8.
 */
export class SmartDecoder {
  // fatal: false is the "Safety First" approach for database integrity.
  private utf8Decoder = new TextDecoder("utf-8", { fatal: false });

  decode(chunk: Uint8Array, isFinal = false): string {
    if (chunk.length === 0) return "";
    return this.utf8Decoder.decode(chunk, { stream: !isFinal });
  }
}

/**
 * One-off decoding for buffers.
 */
export function decodeOutput(buffer: Uint8Array): string {
  return new SmartDecoder().decode(buffer, true);
}
