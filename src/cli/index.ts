import { spawnSync } from "node:child_process";
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { ensureEnv } from "../shared/config";
import { hideConsole, setupWindowsEncoding } from "../utils/process";
import { DaemonClient } from "./client";
import { addCommand } from "./commands/add";
import { editCommand } from "./commands/edit";
import { installCommand } from "./commands/install";
import { killCommand } from "./commands/kill";
import { listCommand } from "./commands/list";
import { logsCommand } from "./commands/logs";
import { removeCommand } from "./commands/remove";
import { runCommand } from "./commands/run";
import { startCommand } from "./commands/start";
import { stopCommand } from "./commands/stop";
import { uninstallCommand } from "./commands/uninstall";

function checkUv() {
  const result = spawnSync("uv", ["--version"], { stdio: "ignore" });
  if (result.status !== 0) {
    console.error("\x1b[31m[Error] 'uv' not found.\x1b[0m");
    console.error("[Tip] Install uv: https://docs.astral.sh/uv/getting-started/installation/\n");
    process.exit(1);
  }
}

// No arguments → start daemon (for auto-launch / double-click)
if (process.argv.length <= 2) {
  hideConsole();
  setupWindowsEncoding();
  ensureEnv();
  await startCommand({ hidden: true });
  process.exit(0);
}

if (process.argv.includes("--hidden")) {
  hideConsole();
}

const program = new Command();

program
  .name("pyrunner")
  .description("Lightweight Python script scheduler via uv")
  .version(pkg.version)
  .hook("preAction", (_thisCommand, actionCommand) => {
    if (["help", "version", "start"].includes(actionCommand.name())) return;
    ensureEnv();
    setupWindowsEncoding();
    if (["add", "run"].includes(actionCommand.name())) checkUv();
  });

program
  .command("add")
  .description("Add a new scheduled task")
  .argument("<name>", "Name of the task")
  .argument("<script>", "Path to the Python script")
  .argument("[cron]", "Cron expression (default: daily at noon)", "0 12 * * *")
  .action((name, script, cron) => addCommand(new DaemonClient(), name, script, cron));

program
  .command("list")
  .alias("ls")
  .description("List all tasks")
  .action(() => listCommand(new DaemonClient()));

program
  .command("remove")
  .alias("rm")
  .description("Remove a task")
  .argument("<name>", "Name of the task")
  .action((name) => removeCommand(new DaemonClient(), name));

program
  .command("start")
  .alias("daemon")
  .description("Start the scheduler daemon")
  .option("--hidden", "Hide console window (Windows only)")
  .action((options) => startCommand(options));

program
  .command("stop")
  .description("Stop the scheduler daemon")
  .action(() => stopCommand(new DaemonClient()));

program
  .command("run")
  .description("Run a task immediately")
  .argument("[name]", "Name of the task")
  .action((name) => runCommand(new DaemonClient(), name));

program
  .command("kill")
  .description("Kill running tasks")
  .argument("[name]", "Name of the task (omit to kill all)")
  .action((name) => killCommand(new DaemonClient(), name));

program
  .command("logs")
  .description("View task output logs")
  .argument("[name]", "Name of the task")
  .option("-n, --lines <count>", "Number of lines to show")
  .action((name, options) =>
    logsCommand(new DaemonClient(), name, options.lines ? parseInt(options.lines, 10) : undefined),
  );

program
  .command("edit")
  .description("Edit an existing task")
  .argument("<name>", "Name of the task")
  .option("-s, --script <path>", "New script path")
  .option("-c, --cron <expression>", "New cron expression")
  .action((name, options) => editCommand(new DaemonClient(), name, options));

program
  .command("install")
  .description("Install pyrunner as a background service")
  .action(() => installCommand());

program
  .command("uninstall")
  .description("Uninstall pyrunner background service")
  .action(() => uninstallCommand());

program.parse();
