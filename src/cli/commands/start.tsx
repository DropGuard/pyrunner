import { runDaemon } from "../../daemon/index";

export async function startCommand(options: { hidden?: boolean }) {
  await runDaemon(options);
}
