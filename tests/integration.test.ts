import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { installCommand } from "../src/cli/commands/install";
import { uninstallCommand } from "../src/cli/commands/uninstall";
import { Config } from "../src/shared/config";
import * as processUtils from "../src/utils/process";

// Mock Bun's $ shell command
mock.module("bun", () => ({
  $: mock(() => Promise.resolve()),
}));

// Mock Ink's render to avoid terminal output during tests
mock.module("ink", () => ({
  render: () => ({ unmount: () => {} }),
  Text: () => null,
  Box: () => null,
}));

// Mock process.exit to avoid killing the test runner
const originalExit = process.exit;
beforeEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: mocking process for testing
  (process as any).exit = (code?: number) => {
    throw new Error(`Process.exit called with code ${code}`);
  };
});
afterEach(() => {
  process.exit = originalExit;
});

const mockEnable = mock(() => Promise.resolve());
const mockDisable = mock(() => Promise.resolve());

mock.module("auto-launch", () => {
  return {
    default: class {
      // biome-ignore lint/suspicious/noExplicitAny: mock class constructor
      constructor(opts: any) {
        // biome-ignore lint/suspicious/noExplicitAny: mocking internal state
        (this as any).opts = opts;
      }
      enable() {
        return mockEnable();
      }
      disable() {
        return mockDisable();
      }
    },
  };
});

describe("Install/Uninstall Integration", () => {
  beforeEach(() => {
    // Mock Bun.file().exists() and other methods
    spyOn(Bun, "file").mockImplementation(
      (_path) =>
        ({
          exists: () => Promise.resolve(true),
          delete: () => Promise.resolve(),
          text: () => Promise.resolve(""),
          writer: () => ({
            write: () => {},
            flush: () => {},
            end: () => {},
          }),
        }) as any,
    );

    // Mock Bun.write
    spyOn(Bun, "write").mockResolvedValue(0 as any);
  });

  test("installCommand correctly configures AutoLaunch and attempts to enable", async () => {
    const config = new Config();
    // 1. Mock getExecutablePath
    spyOn(processUtils, "getExecutablePath").mockReturnValue({
      main: "C:\\bin\\pyrunner.exe",
      execPath: "C:\\bun.exe",
    });

    // 3. Mock Bun.spawn to avoid actually starting a daemon
    // biome-ignore lint/suspicious/noExplicitAny: mocking Bun.spawn return
    spyOn(Bun, "spawn").mockReturnValue({ unref: () => {}, exited: Promise.resolve(0) } as any);

    // 4. Mock global fetch for health check
    // biome-ignore lint/suspicious/noExplicitAny: mocking fetch response
    spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);

    // Run the command
    try {
      await installCommand(config);
      // biome-ignore lint/suspicious/noExplicitAny: catch error for process.exit check
    } catch (e: any) {
      if (!e.message?.includes("Process.exit")) throw e;
    }

    // Verify AutoLaunch was enabled
    expect(mockEnable).toHaveBeenCalled();
  });

  test("uninstallCommand correctly disables AutoLaunch", async () => {
    const config = new Config();
    // Mock getExecutablePath
    spyOn(processUtils, "getExecutablePath").mockReturnValue({
      main: "C:\\bin\\pyrunner.exe",
      execPath: "C:\\bun.exe",
    });

    // Mock global fetch for health check
    // biome-ignore lint/suspicious/noExplicitAny: mocking fetch response
    spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);

    // Run the command
    try {
      await uninstallCommand(config, { wipe: true });
      // biome-ignore lint/suspicious/noExplicitAny: catch error for process.exit check
    } catch (e: any) {
      if (!e.message?.includes("Process.exit")) throw e;
    }

    // Verify AutoLaunch was disabled
    expect(mockDisable).toHaveBeenCalled();
  });
});
