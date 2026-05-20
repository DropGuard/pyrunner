import { render } from "ink";
import type { DaemonClient } from "@/cli/client";
import { SuccessMsg } from "@/cli/components/SuccessMsg";

export async function stopCommand(client: DaemonClient) {
  await client.shutdown();
  render(<SuccessMsg message="Scheduler daemon stopped." />);
}
