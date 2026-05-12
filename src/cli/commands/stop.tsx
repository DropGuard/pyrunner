import { render } from "ink";
import type { DaemonClient } from "../client";
import { SuccessMsg } from "../components/SuccessMsg";

export async function stopCommand(client: DaemonClient) {
  await client.shutdown();
  render(<SuccessMsg message="Scheduler daemon stopped." />);
}
