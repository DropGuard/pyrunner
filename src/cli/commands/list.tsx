import { Box, render, Text } from "ink";
import type { DaemonClient } from "../client";
import { JobTable } from "../components/JobTable";
import { StatusBadge } from "../components/StatusBadge";

export async function listCommand(client: DaemonClient) {
  const _status = await client.getDaemonStatus();
  const jobs = await client.listJobs();

  render(
    <Box flexDirection="column">
      <StatusBadge active={true} />
      {jobs.length === 0 ? <Text>No tasks found.</Text> : <JobTable jobs={jobs} />}
    </Box>,
  );
}
