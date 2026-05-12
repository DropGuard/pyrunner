import { render } from "ink";
import type { DaemonClient } from "../client";
import { ErrorBox } from "../components/ErrorBox";
import { SuccessMsg } from "../components/SuccessMsg";

export async function removeCommand(client: DaemonClient, name: string) {
  try {
    await client.removeJob(name);
    render(<SuccessMsg message={`Task '${name}' removed.`} />);
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
