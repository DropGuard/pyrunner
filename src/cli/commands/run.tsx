import { render, Text } from "ink";
import type { DaemonClient } from "../client";

export async function runCommand(client: DaemonClient, name?: string) {
  if (name) {
    await client.runJob(name);
    render(<Text color="green">Manually triggering task: {name}</Text>);
  } else {
    const jobs = await client.listJobs();
    const idleJobs = jobs.filter((j) => j.status !== "running");
    if (idleJobs.length === 0) {
      render(<Text>No idle tasks found to run.</Text>);
      return;
    }
    for (const job of idleJobs) {
      await client.runJob(job.name);
    }
    render(<Text color="green">Manually triggering {idleJobs.length} idle tasks...</Text>);
  }
}
