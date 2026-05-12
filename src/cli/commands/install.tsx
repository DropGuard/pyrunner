import { existsSync } from "node:fs";
import { resolve } from "node:path";
import AutoLaunch from "auto-launch";
import { render, Text } from "ink";
import { DAEMON_LOCK_PATH } from "../../shared/config";
import { logger } from "../../utils/logger";
import { ErrorBox } from "../components/ErrorBox";
import { SuccessMsg } from "../components/SuccessMsg";

function getExecutablePath(): string {
  const mainPath = resolve(Bun.main);
  const exePath = resolve(process.execPath);

  // Compiled binary: pyrunner.exe
  if (!mainPath.endsWith(".ts") && !mainPath.includes("_npx") && !mainPath.includes("temp")) {
    if (mainPath.endsWith(".js")) return `"${exePath}" "${mainPath}"`;
    return `"${mainPath}"`;
  }
  return "";
}

export async function installCommand() {
  try {
    const command = getExecutablePath();
    if (!command) {
      render(
        <ErrorBox
          error={
            new Error(
              "Cannot install: stable installation not detected. Install globally first: npm install -g @dropguard/pyrunner",
            )
          }
        />,
      );
      process.exit(1);
    }

    logger.info(`Registering auto-start: ${command}`);

    const autoLauncher = new AutoLaunch({
      name: "PyRunner",
      isHidden: true,
    });

    await autoLauncher.enable();

    // Spawn daemon now
    const args = (command.match(/"[^"]+"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ""));
    const proc = Bun.spawn([...args, "start", "--hidden"], {
      detached: true,
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
    proc.unref();

    // Wait for daemon to become active
    let active = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (existsSync(DAEMON_LOCK_PATH)) {
        active = true;
        break;
      }
    }

    if (active) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      active = existsSync(DAEMON_LOCK_PATH);
    }

    if (active) {
      render(<SuccessMsg message="Background service installed and daemon started." />);
    } else {
      render(
        <Text color="yellow">
          Service registered but daemon may not have started. Try running &apos;pyrunner start&apos;
          manually to see error messages.
        </Text>,
      );
    }
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
