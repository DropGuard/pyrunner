import { $ } from "bun";
import { resolve, join } from "node:path";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

// Importing templates as text (Bun will bundle these into the executable)
import systemdTemplate from "../templates/pyrunner.service" with { type: "text" };
import plistTemplate from "../templates/pyrunner.plist" with { type: "text" };
import vbsTemplate from "../templates/pyrunner.vbs" with { type: "text" };

export async function installService() {
  const platform = process.platform;
  const exePath = resolve(process.execPath);
  const mainPath = resolve(Bun.main);
  
  let command = "";
  if (Bun.main.endsWith(".ts")) {
    command = `"${exePath}" run "${mainPath}" daemon`;
  } else {
    command = `"${exePath}" daemon`;
  }

  switch (platform) {
    case "win32": {
      const startupDir = join(process.env.APPDATA!, "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
      const vbsPath = join(startupDir, "pyrunner-daemon.vbs");
      const vbsContent = vbsTemplate.replace("{{COMMAND}}", command.replace(/"/g, '""'));
      writeFileSync(vbsPath, vbsContent);
      console.log(`[Windows] Registered auto-start script: ${vbsPath}`);
      
      const { exitCode } = await $`wscript.exe "${vbsPath}"`.nothrow().quiet();
      if (exitCode === 0) {
        console.log("[Windows] Daemon started in background.");
      } else {
        console.warn("[Windows] Could not start daemon immediately. It will start automatically on next login.");
      }
      break;
    }
    case "linux": {
      const systemdDir = join(homedir(), ".config/systemd/user");
      mkdirSync(systemdDir, { recursive: true });
      const servicePath = join(systemdDir, "pyrunner.service");
      writeFileSync(servicePath, systemdTemplate.replace("{{COMMAND}}", command));
      console.log(`[Linux] Systemd unit created: ${servicePath}`);

      await $`systemctl --user daemon-reload`.quiet();
      await $`systemctl --user enable pyrunner.service`.quiet();
      
      const { exitCode, stderr } = await $`systemctl --user start pyrunner.service`.nothrow().quiet();
      if (exitCode === 0) {
        console.log("[Linux] Systemd service started.");
      } else {
        console.error(`[Linux] Failed to start service: ${stderr.toString().trim()}`);
        console.log("Tip: Try running 'systemctl --user start pyrunner.service' manually.");
      }
      break;
    }
    case "darwin": {
      const agentsDir = join(homedir(), "Library/LaunchAgents");
      mkdirSync(agentsDir, { recursive: true });
      const plistPath = join(agentsDir, "com.pyrunner.daemon.plist");
      
      const argList = command.match(/"[^"]+"|\S+/g) || [];
      const args = argList.map(arg => {
        const cleanArg = arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
        return `        <string>${cleanArg}</string>`;
      }).join("\n");
        
      writeFileSync(plistPath, plistTemplate.replace("{{ARGUMENTS}}", args));
      console.log(`[macOS] LaunchAgent created: ${plistPath}`);

      // Unload first to handle re-installs cleanly
      await $`launchctl unload ${plistPath}`.nothrow().quiet();
      const { exitCode, stderr } = await $`launchctl load -w ${plistPath}`.nothrow().quiet();
      
      if (exitCode === 0) {
        console.log("[macOS] LaunchAgent loaded and started.");
      } else {
        console.error(`[macOS] Failed to load agent: ${stderr.toString().trim()}`);
        console.log(`Tip: Try running 'launchctl load -w ${plistPath}' manually.`);
      }
      break;
    }
    default:
      console.error(`Auto-start installation is not supported on platform: ${platform}`);
      return;
  }
  console.log("Installation complete. The daemon will now manage your tasks.");
}

export async function uninstallService() {
  const platform = process.platform;
  switch (platform) {
    case "win32": {
      const startupDir = join(process.env.APPDATA!, "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
      const vbsPath = join(startupDir, "pyrunner-daemon.vbs");
      if (existsSync(vbsPath)) {
        unlinkSync(vbsPath);
        console.log("[Windows] Uninstalled auto-start script.");
      }
      break;
    }
    case "linux": {
      const servicePath = join(homedir(), ".config/systemd/user/pyrunner.service");
      if (existsSync(servicePath)) {
        await $`systemctl --user stop pyrunner.service`.quiet();
        await $`systemctl --user disable pyrunner.service`.quiet();
        unlinkSync(servicePath);
        console.log("[Linux] Uninstalled systemd service.");
      }
      break;
    }
    case "darwin": {
      const plistPath = join(homedir(), "Library/LaunchAgents/com.pyrunner.daemon.plist");
      if (existsSync(plistPath)) {
        await $`launchctl unload ${plistPath}`.quiet();
        unlinkSync(plistPath);
        console.log("[macOS] Uninstalled LaunchAgent.");
      }
      break;
    }
  }
}
