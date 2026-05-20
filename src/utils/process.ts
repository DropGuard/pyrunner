import { resolve } from "node:path";
import treeKill from "tree-kill";

export function getExecutablePath(
  overrideMain?: string,
  overrideExec?: string,
): { main: string; execPath: string } {
  const main = resolve(overrideMain || Bun.main);
  const execPath = resolve(overrideExec || process.execPath);
  return { main, execPath };
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
