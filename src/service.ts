import { $ } from "bun";
import { resolve, join } from "node:path";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { DAEMON_LOCK_PATH } from "./config";
import { isDaemonActive } from "./db";
import { logger, killProcessTree } from "./utils";

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
      const { exitCode, stderr } = await $`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "PyRunner" /t REG_SZ /d ${hiddenCommand} /f`.nothrow().quiet();

      if (exitCode === 0) {
        logger.success("[Windows] Registered auto-start entry in Registry.");
        await $`start /b ${{ raw: hiddenCommand }}`.nothrow().quiet();
        logger.success("[Windows] Daemon started in background.");
      } else {
        logger.error(`[Windows] Failed to register auto-start: ${stderr.toString()}`);
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
      const { exitCode } = await $`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "PyRunner" /f`.nothrow().quiet();
      if (exitCode === 0) {
        logger.success("[Windows] Removed auto-start entry from Registry.");
      }
      
      const startupDir = join(process.env.APPDATA!, "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
      const vbsPath = join(startupDir, "pyrunner-daemon.vbs");
      if (existsSync(vbsPath)) {
        unlinkSync(vbsPath);
        logger.info("[Windows] Cleaned up legacy VBS script.");
      }
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
