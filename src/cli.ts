#!/usr/bin/env bun
import { Command } from "commander";
import { getDb } from "./db";
import { calculateNextRun } from "./executor";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ensureEnv, LOGS_DIR } from "./config";
import { runDaemon } from "./daemon";
import { installService, uninstallService } from "./service";

const program = new Command();

// Pre-flight check: ensure environment is ready
ensureEnv();

program
  .name("pyrunner")
  .description("Lightweight Python script scheduler via uv")
  .version("0.1.8");

program
  .command("add")
  .description("Add a new scheduled task")
  .argument("<name>", "Name of the task")
  .argument("<script>", "Path to the Python script")
  .argument("[cron]", "Cron expression (e.g., '0 12 * * *')", "0 12 * * *")
  .action((name, script, cron) => {
    const db = getDb();
    const absolutePath = resolve(process.cwd(), script);
    const workingDir = dirname(absolutePath);

    if (!existsSync(absolutePath)) {
      console.error(`Error: Script not found at ${absolutePath}`);
      process.exit(1);
    }

    try {
      const nextRun = calculateNextRun(cron);
      db.prepare(`
        INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, absolutePath, workingDir, cron, nextRun, Date.now());

      console.log(`Task '${name}' added successfully.`);
      console.log(`Next run: ${new Date(nextRun).toLocaleString()}`);
    } catch (e: any) {
      if (e.message.includes("UNIQUE constraint failed")) {
        console.error(`Error: A task named '${name}' already exists.`);
      } else {
        console.error(`Error: ${e.message}`);
      }
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all scheduled tasks")
  .action(() => {
    const db = getDb();
    const jobs = db.query("SELECT * FROM jobs").all() as any[];

    if (jobs.length === 0) {
      console.log("No tasks found.");
      return;
    }

    console.table(jobs.map(j => {
      const scriptExists = existsSync(j.script_path);
      return {
        Name: j.name,
        Status: j.status + (scriptExists ? "" : " (MISSING)"),
        Cron: j.cron,
        "Next Run": new Date(j.next_run_time).toLocaleString(),
        "Last Run": j.last_run_time ? new Date(j.last_run_time).toLocaleString() : "N/A",
        "Last Exit": j.last_exit_code ?? "N/A"
      };
    }));
  });

program
  .command("remove")
  .description("Remove a task")
  .argument("<name>", "Name of the task")
  .action((name) => {
    const db = getDb();
    const result = db.prepare("DELETE FROM jobs WHERE name = ?").run(name);
    if (result.changes > 0) {
      console.log(`Task '${name}' removed.`);
    } else {
      console.log(`Task '${name}' not found.`);
    }
  });

program
  .command("edit")
  .description("Edit an existing task")
  .argument("<name>", "Name of the task")
  .option("-s, --script <path>", "New path to the Python script")
  .option("-c, --cron <expression>", "New cron expression")
  .action((name, options) => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM jobs WHERE name = ?").get(name) as any;

    if (!job) {
      console.error(`Error: Task '${name}' not found.`);
      process.exit(1);
    }

    if (!options.script && !options.cron) {
      console.log("No changes specified. Use --script or --cron.");
      return;
    }

    let scriptPath = job.script_path;
    let workingDir = job.working_dir;
    let cron = job.cron;
    let nextRun = job.next_run_time;

    if (options.script) {
      scriptPath = resolve(process.cwd(), options.script);
      workingDir = dirname(scriptPath);
      if (!existsSync(scriptPath)) {
        console.error(`Error: New script not found at ${scriptPath}`);
        process.exit(1);
      }
    }

    if (options.cron) {
      cron = options.cron;
      try {
        nextRun = calculateNextRun(cron);
      } catch (e: any) {
        console.error(`Error: Invalid cron expression '${cron}'`);
        process.exit(1);
      }
    }

    db.prepare(`
      UPDATE jobs 
      SET script_path = ?, working_dir = ?, cron = ?, next_run_time = ? 
      WHERE name = ?
    `).run(scriptPath, workingDir, cron, nextRun, name);

    console.log(`Task '${name}' updated successfully.`);
    if (options.cron) {
      console.log(`New next run: ${new Date(nextRun).toLocaleString()}`);
    }
  });

program
  .command("logs")
  .description("View logs for a task")
  .argument("<name>", "Name of the task")
  .option("-t, --tail <lines>", "Number of lines to show", "20")
  .action((name, options) => {
    const logPath = join(LOGS_DIR, `${name}.log`);
    if (!existsSync(logPath)) {
      console.error(`No logs found for task '${name}'.`);
      return;
    }

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    const tailCount = parseInt(options.tail);
    console.log(lines.slice(-tailCount).join("\n"));
  });

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
