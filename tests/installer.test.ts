import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { installService } from "@/cli/lifecycle/installer";
import { Config } from "@/shared/config";

describe("Installer Lifecycle", () => {
  const TEST_DIR = join(import.meta.dir, "tmp-home");
  let config: Config;

  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
    config = new Config({
      PYRUNNER_DIR: TEST_DIR,
      HOME: TEST_DIR,
      USERPROFILE: TEST_DIR,
    });
  });

  afterEach(async () => {
    // Keep it for inspection if needed, or cleanup
    // await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should complete installService and log results on Windows", async () => {
    if (process.platform !== "win32") {
      console.log("Skipping Windows-specific lifecycle test on non-Windows platform.");
      return;
    }

    console.log("Starting installService test...");
    console.log(`Test Directory: ${config.pyrunnerDir}`);

    try {
      // We might need a dummy binary if resolveServiceBinary fails in test environment
      // For now, let's see if it works with the current environment
      await installService(config);
      console.log("installService completed successfully.");

      // Verify binary deployment
      const binPath = join(config.binDir, "pyrunner.exe");
      const binExists = await Bun.file(binPath).exists();
      console.log(`Binary deployed at ${binPath}: ${binExists}`);
      expect(binExists).toBe(true);

      // Verify Registry (The unbiased observation)
      console.log("Querying registry for PyRunner auto-launch key...");
      try {
        const { stdout, stderr, exitCode } =
          await $`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v PyRunner`.quiet();
        if (exitCode === 0) {
          console.log("Registry Entry Found:");
          console.log(stdout.toString());
        } else {
          console.log("Registry Entry NOT Found.");
          console.log("Error Output:", stderr.toString());
        }
      } catch (e) {
        console.error("Failed to query registry:", e);
      }
    } catch (error: any) {
      console.error("installService failed with error:");
      console.error(error);
      // Log more details about the error if possible
      if (error.stack) console.error(error.stack);
      throw error;
    }
  });
});
