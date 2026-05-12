import { resolve } from "node:path";
import { render } from "ink";
import type { DaemonClient } from "../client";
import { SuccessMsg } from "../components/SuccessMsg";

export async function editCommand(
  client: DaemonClient,
  name: string,
  options: { script?: string; cron?: string },
) {
  if (!options.script && !options.cron) {
    render(<SuccessMsg message="No changes specified." />);
    return;
  }

  const updates = { ...options };
  if (updates.script) {
    updates.script = resolve(process.cwd(), updates.script);
  }

  await client.editJob(name, updates);
  render(<SuccessMsg message={`Task '${name}' updated.`} />);
}
