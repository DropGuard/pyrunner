import { Box, render, Text } from "ink";
import type { DaemonClient } from "../client";
import { ErrorBox } from "../components/ErrorBox";
import { LogViewer } from "../components/LogViewer";

export async function logsCommand(client: DaemonClient, name?: string, lines?: number) {
  try {
    if (name) {
      const data = await client.getJobLogs(name, lines);
      render(<LogViewer taskName={name} content={data.content} />);
    } else {
      const allLogs = await client.getAllLogs();
      const jobs = await client.listJobs();
      render(
        <Box flexDirection="column">
          <Text color="cyan" bold>
            === Last Execution Logs for All Tasks ===
          </Text>
          {jobs.map((job) => (
            <LogViewer key={job.name} taskName={job.name} content={allLogs[job.name] || ""} />
          ))}
        </Box>,
      );
    }
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
