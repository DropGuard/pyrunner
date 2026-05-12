import { resolve } from "node:path";
import treeKill from "tree-kill";

export function getExecutablePath(
  overrideMain?: string,
  overrideExec?: string,
): { main: string; exe: string } {
  const main = resolve(overrideMain || Bun.main);
  const exe = resolve(overrideExec || process.execPath);
  return { main, exe };
}

export function killProcessTree(pid: number, force = false): Promise<void> {
  return new Promise((resolve) => {
    if (force) {
      treeKill(pid, "SIGKILL", () => resolve());
      return;
    }
    treeKill(pid, "SIGTERM", (err) => {
      if (err) {
        setTimeout(() => {
          treeKill(pid, "SIGKILL", () => resolve());
        }, 500);
      } else {
        resolve();
      }
    });
  });
}

export class SmartDecoder {
  private utf8Decoder = new TextDecoder("utf-8", { fatal: false });

  decode(chunk: Uint8Array, isFinal = false): string {
    if (chunk.length === 0) return "";
    return this.utf8Decoder.decode(chunk, { stream: !isFinal });
  }
}

export function decodeOutput(buffer: Uint8Array): string {
  return new SmartDecoder().decode(buffer, true);
}

export async function setupWindowsEncoding() {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      SetConsoleOutputCP: { args: [FFIType.u32], returns: FFIType.i32 },
    });
    try {
      kernel32.symbols.SetConsoleOutputCP(65001);
    } finally {
      kernel32.close();
    }
  } catch {
    try {
      const proc = Bun.spawn(["cmd", "/c", "chcp", "65001"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {}
  }
}
