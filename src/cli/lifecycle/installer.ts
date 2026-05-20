import { rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import AutoLaunch from "auto-launch";
import { $ } from "bun";
import type { Config } from "@/shared/config";
import { logger } from "@/utils/logger";
import { getBinaryName } from "@/utils/paths";
import { resolveServiceBinary } from "./binary-resolver";

/**
 * Ensures the binary is built if we are running in developer mode.
 * This prevents installing outdated binaries when running from source.
 */
async function ensureDevBuilt(): Promise<void> {
  // Skip if running in test environment
  if (process.env.NODE_ENV === "test") return;

  // Detect if running from TS/TSX source (Developer Mode)
  const isDev = Bun.main.endsWith(".ts") || Bun.main.endsWith(".tsx");
  if (!isDev) return;

  const buildScript = join(import.meta.dir, "..", "..", "..", "scripts", "build.ts");
  if (await Bun.file(buildScript).exists()) {
    logger.info("Developer mode detected. Rebuilding binary...");
    try {
      await $`bun ${buildScript}`.quiet();
      logger.info("Build completed successfully.");
    } catch (e) {
      logger.error(`Automatic build failed: ${e instanceof Error ? e.message : e}`);
      logger.warn("Attempting to proceed with existing binary if available...");
    }
  }
}

/**
 * Installs PyRunner as a system service.
 * Deploys the binary to the bin directory and registers it for auto-launch.
 */
export async function installService(config: Config): Promise<void> {
  await ensureDevBuilt();
  await config.ensureEnv();

  const sourceBinary = await resolveServiceBinary();

  if (!sourceBinary) {
    throw new Error(
      "Could not find a valid pyrunner binary. Please run 'bun run build' first or ensure the platform package is installed.",
    );
  }

  const binName = basename(sourceBinary);
  const targetPath = join(config.binDir, binName);
  const oldPath = `${targetPath}.old`;

  const exists = await Bun.file(targetPath).exists();

  // STEP 1: Rename Trick (Windows compatibility)
  if (exists) {
    logger.info("Found existing installation, preparing update...");

    // Remove any lingering old file from previous failed cleanups
    await unlink(oldPath).catch(() => {});

    // Rename current to .old to free up the targetPath
    await rename(targetPath, oldPath).catch(() => {});
    logger.info(`Renamed existing binary to ${basename(oldPath)}`);
  }

  // STEP 2: Deploy New Version
  logger.info(`Installing PyRunner to: ${targetPath}`);
  await Bun.write(targetPath, Bun.file(sourceBinary));

  // STEP 3: Stop existing daemon (using the NEW binary to send stop command)
  if (exists) {
    logger.info("Requesting existing daemon to shutdown...");
    // Using the new binary we just deployed to send the stop signal
    await Bun.spawn([targetPath, "stop"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited.catch((e) => {
      logger.warn(`Shutdown request failed: ${e.message || e}`);
    });
  }

  // STEP 4: Register Service
  const autoLauncher = new AutoLaunch({
    name: "PyRunner",
    path: targetPath,
    isHidden: true,
  });
  await autoLauncher.enable();

  // STEP 4: Start New Daemon
  logger.info("Starting background daemon...");
  const proc = Bun.spawn([targetPath, "start", "--hidden"], {
    detached: true,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  proc.unref();
}

/**
 * Uninstalls PyRunner from the system.
 * Shuts down the daemon, disables auto-launch, and removes binaries/data.
 */
export async function uninstallService(config: Config, wipe: boolean): Promise<void> {
  // 1. Stop daemon via API if running
  const shutdownUrl = `${config.daemonUrl}/api/v1/daemon/shutdown`;
  await fetch(shutdownUrl, {
    method: "POST",
    unix: config.daemonIpcPath,
  }).catch(() => null);

  // 2. Disable AutoLaunch
  const targetPath = join(config.binDir, getBinaryName());
  const autoLauncher = new AutoLaunch({
    name: "PyRunner",
    path: targetPath,
  });
  await autoLauncher.disable();

  // Wait for the daemon to fully exit (we added a 100ms delay in the daemon shutdown response)
  await new Promise((r) => setTimeout(r, 500));

  // 3. Cleanup logic
  const targetDir = wipe ? config.pyrunnerDir : config.binDir;

  if (process.platform === "win32") {
    // Windows file lock workaround: We cannot delete the .exe while the CLI process itself is running it.
    // Spawn a detached background process that waits 2 seconds (ping) then forcefully deletes the directory.
    Bun.spawn(["cmd.exe", "/c", `ping 127.0.0.1 -n 3 > nul & rmdir /s /q "${targetDir}"`], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    }).unref();
  } else {
    // Unix systems can safely delete running executables
    await $`rm -rf ${targetDir}`;
  }
}
