import { render } from "ink";
import { SuccessMsg } from "@/cli/components/SuccessMsg";
import { installService } from "@/cli/lifecycle/installer";
import type { Config } from "@/shared/config";

export async function installCommand(config: Config) {
  await installService(config);
  render(<SuccessMsg message="Background service installed and daemon started." />);
}
