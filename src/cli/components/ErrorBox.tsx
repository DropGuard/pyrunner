import { Box, Text } from "ink";
import { DaemonOfflineError } from "../../shared/errors";

export function ErrorBox({ error }: { error: unknown }) {
  if (error instanceof DaemonOfflineError) {
    return (
      <Box flexDirection="column">
        <Text color="red">Scheduler daemon is not running.</Text>
        <Text>
          Run <Text bold>pyrunner install</Text> to register as a service, or{" "}
          <Text bold>pyrunner start</Text> to run manually.
        </Text>
      </Box>
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  return <Text color="red">[Error] {message}</Text>;
}
