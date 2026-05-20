import { Box, render, Text } from "ink";
import type { DaemonClient } from "@/cli/client";
import { JobTable } from "@/cli/components/JobTable";
import { StatusBadge } from "@/cli/components/StatusBadge";

export async function listCommand(client: DaemonClient) {
  const jobs = await client.listJobs();

  render(
    <Box flexDirection="column">
      <StatusBadge active={true} />
      {jobs.length === 0 ? <Text>No tasks found.</Text> : <JobTable jobs={jobs} />}
    </Box>,
  );
}
