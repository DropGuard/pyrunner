import { render } from "ink";
import type { DaemonClient } from "../client";
import { ErrorBox } from "../components/ErrorBox";
import { SuccessMsg } from "../components/SuccessMsg";

export async function stopCommand(client: DaemonClient) {
  try {
    await client.shutdown();
    render(<SuccessMsg message="Scheduler daemon stopped." />);
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
