import { resolve } from "node:path";
import { Box, render, Text } from "ink";
import type { DaemonClient } from "@/cli/client";
import { SuccessMsg } from "@/cli/components/SuccessMsg";
import type { EditJobRequest } from "@/shared/types";

export async function editCommand(
  client: DaemonClient,
  name: string,
  options: { script?: string; cron?: string },
) {
  const updates: EditJobRequest = {
    script_path: options.script ? resolve(options.script) : undefined,
    cron: options.cron,
  };

  const result = await client.editJob(name, updates);
  render(
    <Box flexDirection="column">
      <SuccessMsg message={`Task '${name}' updated.`} />
      <Text dimColor>Next run: {new Date(result.next_run_time).toLocaleString()}</Text>
    </Box>,
  );
}
