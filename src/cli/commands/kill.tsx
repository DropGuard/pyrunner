import { render } from "ink";
import type { DaemonClient } from "@/cli/client";
import { SuccessMsg } from "@/cli/components/SuccessMsg";

export async function killCommand(client: DaemonClient, name?: string) {
  if (name) {
    await client.killJob(name);
    render(<SuccessMsg message={`Task '${name}' killed.`} />);
    return;
  }

  const result = await client.killAllJobs();
  render(
    <SuccessMsg
      message={
        result.killed > 0 ? `Killed ${result.killed} running tasks.` : "No running tasks to kill."
      }
    />,
  );
}
