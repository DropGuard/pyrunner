import { Command } from "commander";
import { ensureEnv } from "./config";
import { runDaemon } from "./daemon";
import { installService, uninstallService } from "./service";
import pkg from "../package.json" with { type: "json" };
import { $ } from "bun";
import { createDb } from "./db";
import * as actions from "./actions";

const program = new Command();

// Pre-flight check: ensure environment is ready
ensureEnv();

// Check for required dependencies: bun and uv
async function checkRequirements() {
  const dependencies = [
    {
      name: "bun",
      command: "bun --version",
      hint: "Install Bun from https://bun.sh",
    },
    {
      name: "uv",
      command: "uv --version",
      hint: "Install uv via: curl -LsSf https://astral.sh/uv/install.sh | sh (or visit https://astral.sh/uv)",
    },
  ];

  for (const dep of dependencies) {
    try {
      const { exitCode } = await $`${{ raw: dep.command }}`.quiet().nothrow();
      if (exitCode !== 0) throw new Error();
    } catch (e) {
      console.error(
        `\x1b[31m[Error] Required dependency '${dep.name}' not found.\x1b[0m`,
      );
      console.error(`[Tip] ${dep.hint}\n`);
      process.exit(1);
    }
  }
}

await checkRequirements();

// Windows-specific: Force UTF-8 code page to avoid Mojibake
if (process.platform === "win32") {
  await $`chcp 65001`.quiet().nothrow();
}

// Global DB instance for CLI actions
const db = createDb();

program
  .name("pyrunner")
  .description("Lightweight Python script scheduler via uv")
  .version(pkg.version);

program
  .command("add")
  .description("Add a new scheduled task")
  .argument("<name>", "Name of the task")
  .argument("<script>", "Path to the Python script")
  .argument(
    "[cron]",
    "Cron expression (default: '0 12 * * *' - daily at noon)",
    "0 12 * * *",
  )
  .option("-t, --timeout <seconds>", "Execution timeout in seconds", "600")
  .action((name, script, cron, options) => actions.addJob(db, name, script, cron, options));

program
  .command("list")
  .description("List all scheduled tasks")
  .action(() => actions.listJobs(db));

program
  .command("remove")
  .description("Remove a task")
  .argument("<name>", "Name of the task")
  .action((name) => actions.removeJob(db, name));

program
  .command("stop")
  .description("Stop running tasks (stops all if no name provided)")
  .argument("[name]", "Name of the task")
  .action((name) => actions.stopJob(db, name));

program
  .command("run")
  .description(
    "Execute tasks immediately (runs all idle tasks if no name provided)",
  )
  .argument("[name]", "Name of the task")
  .action((name) => actions.runJob(db, name));

program
  .command("edit")
  .description("Edit an existing task")
  .argument("<name>", "Name of the task")
  .option("-s, --script <path>", "New path to the Python script")
  .option("-c, --cron <expression>", "New cron expression")
  .option("-t, --timeout <seconds>", "New execution timeout in seconds")
  .action((name, options) => actions.editJob(db, name, options));

program
  .command("logs")
  .description(
    "View the latest execution logs for all tasks, or specify a task name",
  )
  .argument("[name]", "Task name (optional)")
  .option(
    "-t, --tail <lines>",
    "Number of lines to show (only for specific task)",
  )
  .action((name, options) => actions.showLogs(db, name, options));

program
  .command("daemon")
  .description("Run the scheduler daemon in the foreground")
  .action(() => {
    runDaemon();
  });

program
  .command("install")
  .description("Install the daemon as an auto-start service")
  .action(async () => {
    await installService();
  });

program
  .command("uninstall")
  .description("Remove the auto-start service")
  .action(async () => {
    await uninstallService();
  });

program.parse();
