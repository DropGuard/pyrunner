import { runDaemon } from "@/daemon/index";
import type { Config } from "@/shared/config";

export async function startCommand(config: Config, options: { hidden?: boolean }) {
  await runDaemon(config, options);
}
