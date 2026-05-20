import { Box, Text } from "ink";
import type { Job } from "@/shared/types";

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

export function JobTable({ jobs }: { jobs: Job[] }) {
  const nameWidth = Math.max(4, ...jobs.map((j) => j.name.length)) + 2;
  const statusWidth = 12;
  const exitWidth = 6;
  const cronWidth = Math.max(4, ...jobs.map((j) => j.cron.length)) + 2;
  const lastRunWidth = 22;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{padRight("Name", nameWidth)}</Text>
        <Text bold>{padRight("Status", statusWidth)}</Text>
        <Text bold>{padRight("Exit", exitWidth)}</Text>
        <Text bold>{padRight("Cron", cronWidth)}</Text>
        <Text bold>{padRight("Last Run", lastRunWidth)}</Text>
        <Text bold>{"Next Run"}</Text>
      </Box>
      <Text>{"─".repeat(nameWidth + statusWidth + exitWidth + cronWidth + lastRunWidth + 20)}</Text>
      {jobs.map((j) => {
        const statusColor =
          j.status === "running" ? "yellow" : j.status === "failed" ? "red" : "green";
        const lastRunStr = j.last_run_time ? new Date(j.last_run_time).toLocaleString() : "-";
        const nextRunStr = j.next_run_time ? new Date(j.next_run_time).toLocaleString() : "-";
        const exitStr = j.last_exit_code !== null ? j.last_exit_code.toString() : "-";
        return (
          <Box key={j.name}>
            <Text>{padRight(j.name, nameWidth)}</Text>
            <Text color={statusColor}>{padRight(j.status, statusWidth)}</Text>
            <Text>{padRight(exitStr, exitWidth)}</Text>
            <Text>{padRight(j.cron, cronWidth)}</Text>
            <Text>{padRight(lastRunStr, lastRunWidth)}</Text>
            <Text>{nextRunStr}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
