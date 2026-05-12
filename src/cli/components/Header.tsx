import { Box, Text } from "ink";
import type { Job } from "../../shared/types";

export function Header({ jobs, port }: { jobs: Job[]; port: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">
        PyRunner Daemon Started
      </Text>
      <Text>Time: {new Date().toLocaleString()}</Text>
      <Text>Port: {port}</Text>
      <Text>Monitoring {jobs.length} tasks:</Text>
      {jobs.map((j) => (
        <Text key={j.name}>
          {" "}
          - {j.name.padEnd(15)} [{j.cron}] Next: {new Date(j.next_run_time).toLocaleString()}
        </Text>
      ))}
    </Box>
  );
}
