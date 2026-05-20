import { resolve } from "node:path";
import { Box, render, Text } from "ink";
import type { DaemonClient } from "@/cli/client";
import { SuccessMsg } from "@/cli/components/SuccessMsg";

export async function addCommand(client: DaemonClient, name: string, script: string, cron: string) {
  const script_path = resolve(script);
  const result = await client.addJob({ name, script_path, cron });
  render(
    <Box flexDirection="column">
      <SuccessMsg message={`Task '${name}' added successfully`} />
      <Text dimColor>Next run: {new Date(result.next_run_time).toLocaleString()}</Text>
    </Box>,
  );
}
