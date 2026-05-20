import { render } from "ink";
import type { DaemonClient } from "@/cli/client";
import { SuccessMsg } from "@/cli/components/SuccessMsg";

export async function removeCommand(client: DaemonClient, name: string) {
  await client.removeJob(name);
  render(<SuccessMsg message={`Task '${name}' removed.`} />);
}
