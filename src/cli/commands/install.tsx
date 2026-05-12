import { copyFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import AutoLaunch from "auto-launch";
import { render, Text } from "ink";
import React from "react";
import { BIN_DIR, DAEMON_IPC_PATH, ensureEnv, getDaemonUrl } from "../../shared/config";
import { logger } from "../../utils/logger";
import { getExecutablePath } from "../../utils/process";
import { SuccessMsg } from "../components/SuccessMsg";

/**
 * Locates the physical binary to be installed.
 * 1. If currently running as a standalone binary, return that path.
 * 2. If running as a script (npx/dev), look for the platform-specific binary relative to the script.
 */
async function findRealBinary(mainPath: string, execPath: string): Promise<string | null> {
  // Strategy 1: Direct path (for compiled binaries)
  const isStandalone = !execPath.match(/bun(.exe)?$/i) && !execPath.match(/node(.exe)?$/i);
  if (isStandalone) {
    try {
      await stat(execPath);
      return execPath;
    } catch {}
  }

  // Strategy 2: Contextual discovery (for npx/npm script runs)
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = `${platform}-${arch}`;
  const binName = process.platform === "win32" ? "pyrunner.exe" : "pyrunner";
  const pkgName = `@dropguard/pyrunner-${target}`;

  const discoveryPaths = [
    join(mainPath, "..", "..", pkgName, "bin", binName), // npm package structure
    join(process.cwd(), binName), // local build
  ];

  for (const p of discoveryPaths) {
    try {
      await stat(p);
      return p;
    } catch {}
  }

  return null;
}

export async function installCommand() {
  await ensureEnv();

  const { main, exe } = getExecutablePath();
  const sourceBinary = await findRealBinary(main, exe);

  if (!sourceBinary) {
    throw new Error(
      "Could not find a valid pyrunner binary to install. " +
        "Please ensure you have installed the platform-specific package or run 'bun build' first.",
    );
  }

  const binName = basename(sourceBinary);
  const targetPath = join(BIN_DIR, binName);

  // STEP 1: Stop existing daemon
  let targetExists = false;
  try {
    await stat(targetPath);
    targetExists = true;
  } catch {}

  if (targetExists) {
    logger.info("Found existing installation, requesting shutdown...");
    try {
      await Bun.spawn([targetPath, "stop"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
    } catch (e) {
      logger.warn("Shutdown request failed, proceeding anyway.");
    }
  }

  // STEP 2: Deploy
  logger.info(`Installing PyRunner to: ${targetPath}`);
  await copyFile(sourceBinary, targetPath);

  // STEP 3: Register Service
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

  render(<SuccessMsg message="Background service installed and daemon started." />);
}
