import { unlink } from "node:fs/promises";
import { Command } from "commander";
import { DaemonClient } from "@/cli/client";
import { addCommand } from "@/cli/commands/add";
import { editCommand } from "@/cli/commands/edit";
import { installCommand } from "@/cli/commands/install";
import { killCommand } from "@/cli/commands/kill";
import { listCommand } from "@/cli/commands/list";
import { logsCommand } from "@/cli/commands/logs";
import { removeCommand } from "@/cli/commands/remove";
import { runCommand } from "@/cli/commands/run";
import { startCommand } from "@/cli/commands/start";
import { stopCommand } from "@/cli/commands/stop";
import { uninstallCommand } from "@/cli/commands/uninstall";
import { cliAction } from "@/cli/utils/command";
import { Config } from "@/shared/config";
import { getExecutablePath } from "@/utils/process";
import pkg from "../../package.json" with { type: "json" };

const config = new Config();

/**
 * Silently cleanup any old binaries left behind by the update process.
 */
async function cleanupOldBinary() {
  try {
    const { execPath } = getExecutablePath();
    const oldPath = `${execPath}.old`;
    if (await Bun.file(oldPath).exists()) {
      await unlink(oldPath);
    }
  } catch (_e) {
    // Ignore errors as the old binary might still be locked
  }
}

// Global initialization
await cleanupOldBinary();

async function checkUv() {
  try {
    const proc = Bun.spawn(["uv", "--version"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error("uv returned non-zero exit code");
    }
  } catch (_e) {
    console.error("\x1b[31m[Error] 'uv' not found or failed to run.\x1b[0m");
    console.error("[Tip] Install uv: https://docs.astral.sh/uv/getting-started/installation/\n");
    process.exit(1);
  }
}

// Route empty args or just --hidden to the start command automatically
if (process.argv.length <= 2 || (process.argv.length === 3 && process.argv[2] === "--hidden")) {
  process.argv.splice(2, 0, "start");
}

const program = new Command();
const client = new DaemonClient(config);

program
  .name("pyrunner")
  .description(
    "Lightweight Python script scheduler via uv. Running without arguments starts the daemon.",
  )
  .version(pkg.version)
  .hook("preAction", async (_thisCommand, actionCommand) => {
    if (["help", "version", "start", "daemon"].includes(actionCommand.name())) return;
    await config.ensureEnv();
    if (["add", "run"].includes(actionCommand.name())) await checkUv();
  });

program
  .command("add")
  .description("Add a new scheduled task")
  .argument("<name>", "Name of the task")
  .argument("<script>", "Path to the Python script")
  .argument("[cron]", "Cron expression (default: daily at noon)", "0 12 * * *")
  .action(cliAction((name, script, cron) => addCommand(client, name, script, cron)));

program
  .command("list")
  .alias("ls")
  .description("List all tasks")
  .action(cliAction(() => listCommand(client)));

program
  .command("remove")
  .alias("rm")
  .description("Remove a task")
  .argument("<name>", "Name of the task")
  .action(cliAction((name) => removeCommand(client, name)));

program
  .command("start")
  .alias("daemon")
  .description("Start the scheduler daemon (default)")
  .option("--hidden", "Run in hidden mode (internal use)")
  .action(cliAction((options) => startCommand(config, options)));

program
  .command("stop", { hidden: true })
  .description("Stop the scheduler daemon")
  .action(cliAction(() => stopCommand(client)));

program
  .command("run")
  .description("Run all tasks or a specific task")
  .argument("[name]", "Name of the task")
  .action(cliAction((name) => runCommand(client, name)));

program
  .command("kill")
  .description("Kill all tasks or a specific task")
  .argument("[name]", "Name of the task")
  .action(cliAction((name) => killCommand(client, name)));

program
  .command("logs")
  .description("View task output logs")
  .argument("[name]", "Name of the task")
  .option("-n, --lines <count>", "Number of lines to show")
  .action(
    cliAction((name, options) =>
      logsCommand(client, name, options.lines ? parseInt(options.lines, 10) : undefined),
    ),
  );

program
  .command("edit")
  .description("Edit an existing task")
  .argument("<name>", "Name of the task")
  .option("-s, --script <path>", "New script path")
  .option("-c, --cron <expression>", "New cron expression")
  .action(cliAction((name, options) => editCommand(client, name, options)));

program
  .command("install")
  .description("Install pyrunner as a background service")
  .action(cliAction(() => installCommand(config)));

program
  .command("uninstall")
  .description("Uninstall pyrunner background service")
  .option("-w, --wipe", "Remove all data (database and logs)")
  .action(cliAction((options) => uninstallCommand(config, options)));

await program.parseAsync();
