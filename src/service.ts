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
  
  // Try to find a stable global 'pyrunner' command in the system PATH
  let globalCmd = "";
  try {
    const checkCmd = platform === "win32" ? "where.exe pyrunner" : "which -a pyrunner";
    const { stdout } = await $`${{ raw: checkCmd }}`.quiet();
    const paths = stdout.toString().trim().split("\n");
    
    // Filter out the current directory and any development/temp paths
    globalCmd = paths.find(p => {
      const lowP = p.toLowerCase();
      return !p.includes(process.cwd()) && 
             !lowP.includes("_npx") && 
             !lowP.includes("npm-cache") && 
             !lowP.includes("temp");
    }) || "";
  } catch (e) {
    // Command not found in PATH
  }

  // If we can't find a global command, and the current execution is also not a candidate for global
  const mainPath = resolve(Bun.main);
  const isGlobalCandidate = mainPath.includes("node_modules") || 
                            mainPath.includes("scoop") || 
                            (platform !== "win32" && (mainPath.includes("/bin/") || mainPath.includes("/usr/local/")));

  const exePath = resolve(process.execPath);
  let finalCommand = "";

  if (globalCmd) {
    finalCommand = `"${globalCmd.trim()}" daemon`;
  } else if (isGlobalCandidate && !Bun.main.endsWith(".ts")) {
    // If it's a JS file, we MUST prefix it with the executor (bun) to avoid Windows association prompts
    if (mainPath.endsWith(".js")) {
      finalCommand = `"${exePath}" "${mainPath}" daemon`;
    } else {
      finalCommand = platform === "win32" ? `"${mainPath}" daemon` : `pyrunner daemon`;
    }
  } else {
    console.error("\x1b[31m[Error] Cannot install background service: Global installation not found.\x1b[0m");
    console.error("[Tip] Please install pyrunner globally first: \x1b[36mnpm install -g @dropguard/pyrunner\x1b[0m");
    console.error("[Note] Background services must point to a stable global path, not a source or temporary directory.");
    throw new Error("Global installation required for service installation.");
  }

  console.log(`[Info] Installing background service pointing to: ${finalCommand}`);

  switch (platform) {
    case "win32": {
      const startupDir = join(process.env.APPDATA!, "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
      const vbsPath = join(startupDir, "pyrunner-daemon.vbs");
      const vbsContent = vbsTemplate.replace("{{COMMAND}}", finalCommand.replace(/"/g, '""'));
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
      writeFileSync(servicePath, systemdTemplate.replace("{{COMMAND}}", finalCommand));
      console.log(`[Linux] Systemd unit created: ${servicePath}`);

      await $`systemctl --user daemon-reload`.quiet();
      await $`systemctl --user enable pyrunner.service`.quiet();
      
      const { exitCode, stderr } = await $`systemctl --user start pyrunner.service`.nothrow().quiet();
      if (exitCode === 0) {
        console.log("[Linux] Systemd service started.");
      } else {
        console.error(`[Linux] Failed to start service: ${stderr.toString().trim()}`);
      }
      break;
    }
    case "darwin": {
      const agentsDir = join(homedir(), "Library/LaunchAgents");
      mkdirSync(agentsDir, { recursive: true });
      const plistPath = join(agentsDir, "com.pyrunner.daemon.plist");
      
      const argList = finalCommand.match(/"[^"]+"|\S+/g) || [];
      const args = argList.map(arg => {
        const cleanArg = arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
        return `        <string>${cleanArg}</string>`;
      }).join("\n");
        
      writeFileSync(plistPath, plistTemplate.replace("{{ARGUMENTS}}", args));
      console.log(`[macOS] LaunchAgent created: ${plistPath}`);

      await $`launchctl unload ${plistPath}`.nothrow().quiet();
      const { exitCode, stderr } = await $`launchctl load -w ${plistPath}`.nothrow().quiet();
      
      if (exitCode === 0) {
        console.log("[macOS] LaunchAgent loaded and started.");
      } else {
        console.error(`[macOS] Failed to load agent: ${stderr.toString().trim()}`);
      }
      break;
    }
  }
  console.log("Installation complete.");
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
