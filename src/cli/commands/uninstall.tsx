import { existsSync, readFileSync, unlinkSync } from "node:fs";
import AutoLaunch from "auto-launch";
import { render } from "ink";
import { DAEMON_LOCK_PATH } from "../../shared/config";
import { killProcessTree } from "../../utils/process";
import { ErrorBox } from "../components/ErrorBox";
import { SuccessMsg } from "../components/SuccessMsg";

export async function uninstallCommand() {
  try {
    // Stop daemon if running
    if (existsSync(DAEMON_LOCK_PATH)) {
      try {
        const pid = parseInt(readFileSync(DAEMON_LOCK_PATH, "utf-8").trim(), 10);
        if (!Number.isNaN(pid)) {
          await killProcessTree(pid);
        }
      } catch {}
      try {
        unlinkSync(DAEMON_LOCK_PATH);
      } catch {}
    }

    const autoLauncher = new AutoLaunch({ name: "PyRunner" });
    await autoLauncher.disable();

    render(<SuccessMsg message="Background service uninstalled." />);
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
