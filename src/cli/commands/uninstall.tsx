import { rm } from "node:fs/promises";
import { ConfirmInput } from "@inkjs/ui";
import AutoLaunch from "auto-launch";
import { Box, render, Text } from "ink";
import { BIN_DIR, DAEMON_IPC_PATH, getDaemonUrl, PYRUNNER_DIR } from "../../shared/config";
import { getExecutablePath } from "../../utils/process";
import { SuccessMsg } from "../components/SuccessMsg";

export async function uninstallCommand(options: { wipe?: boolean } = {}) {
  // 1. Stop daemon via API if running
  const shutdownUrl = `${getDaemonUrl()}/api/v1/daemon/shutdown`;
  await fetch(shutdownUrl, {
    method: "POST",
    unix: DAEMON_IPC_PATH,
  }).catch(() => null);

  // 2. Disable AutoLaunch
  const { exe } = getExecutablePath();
  const autoLauncher = new AutoLaunch({
    name: "PyRunner",
    path: exe,
  });
  await autoLauncher.disable();

  // 3. Cleanup logic
  const cleanup = async (wipe: boolean) => {
    if (wipe) {
      await rm(PYRUNNER_DIR, { recursive: true, force: true });
    } else {
      await rm(BIN_DIR, { recursive: true, force: true });
    }
  };

  if (options.wipe) {
    await cleanup(true);
    render(<SuccessMsg message="PyRunner uninstalled and all data wiped." />);
    return;
  }

  // Interactive prompt
  const { unmount } = render(
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Do you want to completely remove all data (database and logs)?</Text>
      <ConfirmInput
        onConfirm={async () => {
          await cleanup(true);
          unmount();
          render(<SuccessMsg message="PyRunner uninstalled and all data wiped." />);
        }}
        onCancel={async () => {
          await cleanup(false);
          unmount();
          render(<SuccessMsg message="PyRunner uninstalled. Data kept in ~/.pyrunner" />);
        }}
      />
    </Box>,
  );
}
