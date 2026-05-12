import { render } from "ink";
import type { DaemonClient } from "../client";
import { SuccessMsg } from "../components/SuccessMsg";

export async function removeCommand(client: DaemonClient, name: string) {
  await client.removeJob(name);
  render(<SuccessMsg message={`Task '${name}' removed.`} />);
}
