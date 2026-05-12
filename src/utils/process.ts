import treeKill from "tree-kill";

export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    treeKill(pid, "SIGTERM", (err) => {
      if (err) {
        setTimeout(() => {
          treeKill(pid, "SIGKILL", () => resolve());
        }, 2000);
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

export function setupWindowsEncoding() {
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
      Bun.spawnSync(["cmd", "/c", "chcp", "65001"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {}
  }
}

export function hideConsole() {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      GetConsoleWindow: { args: [], returns: FFIType.pointer },
      FreeConsole: { args: [], returns: FFIType.i32 },
    });
    const user32 = dlopen("user32.dll", {
      ShowWindow: { args: [FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
    });
    try {
      const hwnd = kernel32.symbols.GetConsoleWindow();
      if (hwnd) user32.symbols.ShowWindow(hwnd, 0);
      kernel32.symbols.FreeConsole();
    } finally {
      kernel32.close();
      user32.close();
    }
  } catch {}
}
