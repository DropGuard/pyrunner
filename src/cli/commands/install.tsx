import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";
import AutoLaunch from "auto-launch";
import { render, Text } from "ink";
import { BIN_DIR, DAEMON_IPC_PATH, ensureEnv, getDaemonUrl } from "../../shared/config";
import { logger } from "../../utils/logger";
import { getExecutablePath } from "../../utils/process";
import { SuccessMsg } from "../components/SuccessMsg";

/**
 * Locates the physical binary to be installed.
 * 1. If currently running as a standalone binary, return that path.
 * 2. If running as a script (npx/dev), look for the platform-specific binary relative to the script.
 */
function findRealBinary(mainPath: string, execPath: string): string | null {
  // Strategy 1: Direct path (for compiled binaries)
  const isStandalone = !execPath.match(/bun(.exe)?$/i) && !execPath.match(/node(.exe)?$/i);
  if (isStandalone && existsSync(execPath)) return execPath;

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
    if (existsSync(p)) return p;
  }

  return null;
}

export async function installCommand() {
  ensureEnv();

  const { main, exe } = getExecutablePath();
  const sourceBinary = findRealBinary(main, exe);

  if (!sourceBinary) {
    throw new Error(
      "Could not find a valid pyrunner binary to install. " +
        "Please ensure you have installed the platform-specific package or run 'bun build' first.",
    );
  }

  const binName = basename(sourceBinary);
  const targetPath = join(BIN_DIR, binName);

  // STEP 1: Gracefully stop existing daemon using the ALREADY INSTALLED binary
  if (existsSync(targetPath)) {
    logger.info("Found existing installation, requesting graceful shutdown...");
    try {
      // Use the targetPath (the old version) to run its own 'stop' command.
      // This ensures the correct port/logic is used for that specific version.
      Bun.spawnSync([targetPath, "stop"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      // Give the OS a moment to release file handles after process exit
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (e) {
      logger.warn("Graceful shutdown via existing binary failed, proceeding with deployment.");
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

  // STEP 5: Verification (Health Check)
  let active = false;
  const healthUrl = `${getDaemonUrl()}/api/v1/health`;

  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const res = await fetch(healthUrl, { unix: DAEMON_IPC_PATH }).catch(() => null);
    if (res?.ok) {
      active = true;
      break;
    }
  }

  if (active) {
    render(<SuccessMsg message="Background service installed and daemon started." />);
  } else {
    throw new Error(
      "Daemon failed to start after installation. Please try running 'pyrunner start' manually.",
    );
  }
}
