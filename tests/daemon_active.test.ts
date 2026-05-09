import { expect, test, describe, spyOn, afterEach } from "bun:test";
import { isDaemonActive } from "../src/db";
import * as fs from "node:fs";
import { DAEMON_LOCK_PATH } from "../src/config";

describe("isDaemonActive Logic", () => {
  afterEach(() => {
    spyOn(fs, "existsSync").mockRestore();
    spyOn(fs, "readFileSync").mockRestore();
    spyOn(process, "kill").mockRestore();
  });

  test("should detect daemon process when lockfile exists and process is alive", () => {
    spyOn(fs, "existsSync").mockImplementation((path) => path === DAEMON_LOCK_PATH);
    // Explicitly casting to avoid TS overload confusion
    (spyOn(fs, "readFileSync") as any).mockImplementation((path: string) => {
      if (path === DAEMON_LOCK_PATH) return "12345";
      return "";
    });
    // Mock process.kill(pid, 0) to succeed
    spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 12345 && signal === 0) return true;
      return true;
    });

    const result = isDaemonActive();
    expect(result).toBe(true);
  });

  test("should return false if lockfile does not exist", () => {
    spyOn(fs, "existsSync").mockReturnValue(false);
    const result = isDaemonActive();
    expect(result).toBe(false);
  });

  test("should return false if lockfile belongs to current process", () => {
    spyOn(fs, "existsSync").mockReturnValue(true);
    (spyOn(fs, "readFileSync") as any).mockReturnValue(process.pid.toString());
    spyOn(process, "kill").mockReturnValue(true);

    const result = isDaemonActive();
    expect(result).toBe(false);
  });

  test("should return false if process in lockfile is not alive", () => {
    spyOn(fs, "existsSync").mockReturnValue(true);
    (spyOn(fs, "readFileSync") as any).mockReturnValue("999999");
    spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const result = isDaemonActive();
    expect(result).toBe(false);
  });
});
