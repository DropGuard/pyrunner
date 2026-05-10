import { Command } from "commander";
import { ensureEnv } from "./config";
import { runDaemon } from "./daemon";
import { installService, uninstallService } from "./service";
import pkg from "../package.json" with { type: "json" };
import { $ } from "bun";
import { createDb, JobRepository } from "./db";
import * as actions from "./actions";
import { setupWindowsEncoding, hideConsole } from "./utils";

// Early hide for Windows background mode to minimize flash
if (process.argv.includes("--hidden")) {
  hideConsole();
}

const program = new Command();


// Helper to wrap async/sync actions for error handling
const wrapAction = (action: (...args: any[]) => any) => async (...args: any[]) => {
  try {
    const result = action(...args);
    if (result instanceof Promise) {
      await result;
    }
  } catch (e) {
    console.error(`\x1b[31m[Error] ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
    process.exit(1);
  }
};

// Check for required dependencies: bun, uv and python version
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
      hint: "Install uv via: curl -LsSf https://astral.sh/uv/install.sh | sh",
    },
  ];

  for (const dep of dependencies) {
    try {
      const { exitCode } = await $`${{ raw: dep.command }}`.quiet().nothrow();
      if (exitCode !== 0) throw new Error();
    } catch (e) {
      console.error(`\x1b[31m[Error] Required dependency '${dep.name}' not found.\x1b[0m`);
      console.error(`[Tip] ${dep.hint}\n`);
      process.exit(1);
    }
  }

  // Strict Python Version Check (Ensures UTF-8 support)
  try {
    const output = await $`uv run python --version`.quiet().text();
    const match = output.match(/Python (\d+)\.(\d+)/);
    if (match && match[1] && match[2]) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      if (major < 3 || (major === 3 && minor < 8)) {
        console.error(`\x1b[31m[Error] Python version ${major}.${minor} is too old.\x1b[0m`);
        console.error(`[Tip] PyRunner requires Python 3.8+ to guarantee UTF-8 encoding support.\n`);
        process.exit(1);
      }
    }
  } catch (e) {
    // If uv run python fails, it will be caught by the user during the first task run anyway
  }
}

// Global instances for CLI actions
const db = createDb();
const repo = new JobRepository(db);

program
  .name("pyrunner")
  .description("Lightweight Python script scheduler via uv")
  .version(pkg.version)
  .hook("preAction", async (thisCommand, actionCommand) => {
    // Skip checks for help/version
    if (["help", "version"].includes(actionCommand.name())) return;

    ensureEnv();
    await checkRequirements();
    setupWindowsEncoding();
  });

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
  .action(wrapAction((name, script, cron) => actions.addJob(repo, name, script, cron)));

program
  .command("list")
  .alias("ls")
  .description("List all tasks")
  .action(wrapAction(() => actions.listJobs(repo)));

program
  .command("remove")
  .alias("rm")
  .description("Remove a task")
  .argument("<name>", "Name of the task")
  .action(wrapAction((name) => actions.removeJob(repo, name)));

program
  .command("start")
  .alias("daemon")
  .description("Start the scheduler daemon")
  .option("--hidden", "Hide console window (Windows only)")
  .action(wrapAction((options) => runDaemon(options)));

program
  .command("stop")
  .description("Stop the scheduler daemon")
  .action(wrapAction(() => actions.stopDaemon()));

program
  .command("run")
  .description("Run a task immediately")
  .argument("[name]", "Name of the task")
  .action(wrapAction((name) => actions.runJob(repo, name)));

program
  .command("kill")
  .description("Kill running tasks")
  .argument("[name]", "Name of the task (omit to kill all)")
  .action(wrapAction((name) => actions.killTasks(repo, name)));

program
  .command("logs")
  .description("View task output logs")
  .argument("[name]", "Name of the task")
  .option("-n, --lines <count>", "Number of lines to show")
  .action(wrapAction((name, options) => actions.showLogs(repo, name, options)));

program
  .command("edit")
  .description("Edit an existing task")
  .argument("<name>", "Name of the task")
  .option("-s, --script <path>", "New script path")
  .option("-c, --cron <expression>", "New cron expression")
  .action(wrapAction((name, options) => actions.editJob(repo, name, options)));

program
  .command("install")
  .description("Install pyrunner as a background service")
  .action(wrapAction(() => installService()));

program
  .command("uninstall")
  .description("Uninstall pyrunner background service")
  .action(wrapAction(() => uninstallService()));

program.parse();
