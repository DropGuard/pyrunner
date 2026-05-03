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
      console.log(`[Windows] Installed auto-start script at: ${vbsPath}`);
      break;
    }
    case "linux": {
      const systemdDir = join(homedir(), ".config/systemd/user");
      mkdirSync(systemdDir, { recursive: true });
      const servicePath = join(systemdDir, "pyrunner.service");
      const serviceContent = systemdTemplate.replace("{{COMMAND}}", command);
      writeFileSync(servicePath, serviceContent);
      await $`systemctl --user daemon-reload`.quiet();
      await $`systemctl --user enable pyrunner.service`.quiet();
      await $`systemctl --user start pyrunner.service`.quiet();
      console.log(`[Linux] Installed and started systemd user service: ${servicePath}`);
      break;
    }
    case "darwin": {
      const agentsDir = join(homedir(), "Library/LaunchAgents");
      mkdirSync(agentsDir, { recursive: true });
      const plistPath = join(agentsDir, "com.pyrunner.daemon.plist");
      
      // Improved argument splitting for macOS plist
      const argList = command.match(/"[^"]+"|\S+/g) || [];
      const args = argList
        .map(arg => {
          const cleanArg = arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
          return `        <string>${cleanArg}</string>`;
        })
        .join("\n");
        
      const plistContent = plistTemplate.replace("{{ARGUMENTS}}", args);
      writeFileSync(plistPath, plistContent);
      await $`launchctl load ${plistPath}`.quiet();
      console.log(`[macOS] Installed and loaded LaunchAgent: ${plistPath}`);
      break;
    }
    default:
      console.log(`Auto-start installation is not supported on platform: ${platform}`);
  }
  console.log("The daemon will now start automatically.");
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
