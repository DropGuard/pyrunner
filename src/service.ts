import { $ } from "bun";
import { resolve, join } from "node:path";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { DAEMON_LOCK_PATH } from "./config";
import { isDaemonActive } from "./db";
import { logger, killProcessTree } from "./utils";

/**
 * Windows-specific Registry management via FFI to avoid console flashes.
 * This is used for auto-start registration in 'Run' key.
 */
function manageWindowsAutoStart(command?: string) {
  if (process.platform !== "win32") return;

  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  let advapi32;
  try {
    advapi32 = dlopen("advapi32.dll", {
      RegOpenKeyExW: {
        args: [FFIType.pointer, FFIType.pointer, FFIType.u32, FFIType.u32, FFIType.pointer],
        returns: FFIType.i32,
      },
      RegSetValueExW: {
        args: [FFIType.pointer, FFIType.pointer, FFIType.u32, FFIType.u32, FFIType.pointer, FFIType.u32],
        returns: FFIType.i32,
      },
      RegDeleteValueW: {
        args: [FFIType.pointer, FFIType.pointer],
        returns: FFIType.i32,
      },
      RegCloseKey: {
        args: [FFIType.pointer],
        returns: FFIType.i32,
      },
    });
  } catch (e) {
    throw new Error(`Failed to load advapi32.dll: ${e instanceof Error ? e.message : String(e)}`);
  }

  const HKEY_CURRENT_USER = 0x80000001;
  const subKey = Buffer.from("Software\\Microsoft\\Windows\\CurrentVersion\\Run\0", "utf16le");
  const valueName = Buffer.from("PyRunner\0", "utf16le");
  
  const phkResult = new BigUint64Array(1);
  const KEY_SET_VALUE = 0x0002;
  const ERROR_SUCCESS = 0;

  const openResult = advapi32.symbols.RegOpenKeyExW(
    HKEY_CURRENT_USER,
    ptr(subKey),
    0,
    KEY_SET_VALUE,
    ptr(phkResult)
  );

  if (openResult !== ERROR_SUCCESS) {
    advapi32.close();
    throw new Error(`Failed to open Registry key (Error Code: ${openResult}). Check permissions.`);
  }

  const hKey = phkResult[0] as any;

  try {
    if (command) {
      const valueData = Buffer.from(command + "\0", "utf16le");
      const setRes = advapi32.symbols.RegSetValueExW(
        hKey,
        ptr(valueName),
        0,
        1, // REG_SZ
        ptr(valueData),
        valueData.length
      );
      if (setRes !== ERROR_SUCCESS) {
        throw new Error(`Failed to set Registry value (Error Code: ${setRes}).`);
      }
    } else {
      const delRes = advapi32.symbols.RegDeleteValueW(hKey, ptr(valueName));
      // 2 = ERROR_FILE_NOT_FOUND, which means it's already gone, we consider this success
      if (delRes !== ERROR_SUCCESS && delRes !== 2) {
        throw new Error(`Failed to delete Registry value (Error Code: ${delRes}).`);
      }
    }
  } finally {
    advapi32.symbols.RegCloseKey(hKey);
    advapi32.close();
  }
}


export async function installService() {
  const platform = process.platform;
  let finalCommand = "";

  const mainPath = resolve(Bun.main);
  const exePath = resolve(process.execPath);
  
  const isDevOrTemp = mainPath.endsWith(".ts") || mainPath.includes("_npx") || mainPath.includes("temp");

  if (!isDevOrTemp) {
    if (mainPath.endsWith(".js")) {
      finalCommand = `"${exePath}" "${mainPath}" daemon`;
    } else {
      finalCommand = `"${mainPath}" daemon`;
    }
  }

  if (!finalCommand) {
    logger.error("Cannot install background service: Stable installation not detected.");
    console.error("[Tip] Please install pyrunner globally first: npm install -g @dropguard/pyrunner");
    throw new Error("Global installation required for service installation.");
  }

  logger.info(`Installing background service pointing to: ${finalCommand}`);

  switch (platform) {
    case "win32": {
      const hiddenCommand = `${finalCommand} --hidden`;
      manageWindowsAutoStart(hiddenCommand);
      logger.success("[Windows] Registered auto-start entry in Registry.");

      // Spawn daemon detached
      const args = (hiddenCommand.match(/"[^"]+"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ""));
      const proc = Bun.spawn(args, {
        detached: true,
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
      });
      proc.unref();
      
      // Verify daemon started and stays running
      let active = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (isDaemonActive()) {
          active = true;
          break;
        }
      }

      // Double check after a short delay to ensure it didn't crash immediately
      if (active) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!isDaemonActive()) active = false;
      }

      if (active) {
        logger.success("[Windows] Daemon started in background.");
      } else {
        logger.error("[Windows] Daemon failed to start in background.");
        console.error("[Tip] Try running 'pyrunner daemon' manually to see error messages.");
      }
      break;
    }

    case "linux": {
      const systemdDir = join(homedir(), ".config/systemd/user");
      mkdirSync(systemdDir, { recursive: true });
      const servicePath = join(systemdDir, "pyrunner.service");
      
      const serviceContent = `[Unit]
Description=PyRunner - Lightweight Python Script Scheduler
After=network.target

[Service]
Type=simple
ExecStart=${finalCommand}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
      
      writeFileSync(servicePath, serviceContent);
      logger.success(`[Linux] Systemd unit created: ${servicePath}`);

      await $`systemctl --user daemon-reload`.quiet();
      await $`systemctl --user enable pyrunner.service`.quiet();

      const { exitCode, stderr } = await $`systemctl --user start pyrunner.service`.nothrow().quiet();
      if (exitCode === 0) {
        logger.success("[Linux] Systemd service started.");
      } else {
        logger.error(`[Linux] Failed to start service: ${stderr.toString().trim()}`);
      }
      break;
    }
    case "darwin": {
      const agentsDir = join(homedir(), "Library/LaunchAgents");
      mkdirSync(agentsDir, { recursive: true });
      const plistPath = join(agentsDir, "com.pyrunner.daemon.plist");

      const argList = finalCommand.match(/"[^"]+"|\S+/g) || [];
      const xmlArgs = argList
        .map((arg) => {
          const cleanArg = arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
          return `        <string>${cleanArg}</string>`;
        })
        .join("\n");

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pyrunner.daemon</string>
    <key>ProgramArguments</key>
    <array>
${xmlArgs}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(homedir(), ".pyrunner/daemon.stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(homedir(), ".pyrunner/daemon.stderr.log")}</string>
</dict>
</plist>`;

      writeFileSync(plistPath, plistContent);
      logger.success(`[macOS] LaunchAgent created: ${plistPath}`);

      await $`launchctl unload ${plistPath}`.nothrow().quiet();
      const { exitCode, stderr } = await $`launchctl load -w ${plistPath}`.nothrow().quiet();

      if (exitCode === 0) {
        logger.success("[macOS] LaunchAgent loaded and started.");
      } else {
        logger.error(`[macOS] Failed to load agent: ${stderr.toString().trim()}`);
      }
      break;
    }
  }
}

export async function uninstallService() {
  const platform = process.platform;

  if (isDaemonActive()) {
    try {
      const lockContent = await Bun.file(DAEMON_LOCK_PATH).text();
      const pid = parseInt(lockContent.trim());
      if (!isNaN(pid)) {
        await killProcessTree(pid);
        logger.info(`Stopped active daemon (PID: ${pid}).`);
      }
    } catch (e) {}
  }

  if (existsSync(DAEMON_LOCK_PATH)) {
    try {
      unlinkSync(DAEMON_LOCK_PATH);
      logger.info("Removed daemon lockfile.");
    } catch (e) {}
  }

  switch (platform) {
    case "win32": {
      manageWindowsAutoStart();
      logger.success("[Windows] Removed auto-start entry from Registry.");
      break;
    }
    case "linux": {
      const servicePath = join(homedir(), ".config/systemd/user/pyrunner.service");
      if (existsSync(servicePath)) {
        await $`systemctl --user stop pyrunner.service`.quiet();
        await $`systemctl --user disable pyrunner.service`.quiet();
        unlinkSync(servicePath);
        logger.success("[Linux] Uninstalled systemd service.");
      }
      break;
    }
    case "darwin": {
      const plistPath = join(homedir(), "Library/LaunchAgents/com.pyrunner.daemon.plist");
      if (existsSync(plistPath)) {
        await $`launchctl unload ${plistPath}`.quiet();
        unlinkSync(plistPath);
        logger.success("[macOS] Uninstalled LaunchAgent.");
      }
      break;
    }
  }
}
