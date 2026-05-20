import { ConfirmInput } from "@inkjs/ui";
import { Box, render, Text } from "ink";
import { SuccessMsg } from "@/cli/components/SuccessMsg";
import { uninstallService } from "@/cli/lifecycle/installer";
import type { Config } from "@/shared/config";

export async function uninstallCommand(config: Config, options: { wipe?: boolean } = {}) {
  if (options.wipe) {
    await uninstallService(config, true);
    render(<SuccessMsg message="PyRunner uninstalled and all data wiped." />);
    return;
  }

  // Interactive prompt
  const { unmount } = render(
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Do you want to completely remove all data (database and logs)?</Text>
      <ConfirmInput
        onConfirm={async () => {
          await uninstallService(config, true);
          unmount();
          render(<SuccessMsg message="PyRunner uninstalled and all data wiped." />);
        }}
        onCancel={async () => {
          await uninstallService(config, false);
          unmount();
          render(<SuccessMsg message="PyRunner uninstalled. Data kept in ~/.pyrunner" />);
        }}
      />
    </Box>,
  );
}
