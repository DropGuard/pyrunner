import { resolve } from "node:path";
import { render, Text } from "ink";
import type { DaemonClient } from "../client";
import { ErrorBox } from "../components/ErrorBox";
import { SuccessMsg } from "../components/SuccessMsg";

export async function addCommand(client: DaemonClient, name: string, script: string, cron: string) {
  try {
    const absolutePath = resolve(process.cwd(), script);
    const result = await client.addJob({ name, script_path: absolutePath, cron });
    render(
      <>
        <SuccessMsg message={`Task '${name}' added successfully using cron: '${cron}'`} />
        <Text>Next run: {new Date(result.next_run_time).toLocaleString()}</Text>
      </>,
    );
  } catch (err) {
    render(<ErrorBox error={err} />);
    process.exit(1);
  }
}
