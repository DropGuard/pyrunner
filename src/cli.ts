#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, type Job } from "./db";
import { calculateNextRun } from "./executor";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ensureEnv, LOGS_DIR } from "./config";
import { runDaemon } from "./daemon";
import { installService, uninstallService } from "./service";
import pkg from "../package.json" with { type: "json" };
import { $ } from "bun";

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
      db.prepare(
        `
        INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(name, absolutePath, workingDir, cron, nextRun, Date.now());

      console.log(`Task '${name}' added successfully using cron: '${cron}'`);
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
    const jobs = db.query("SELECT * FROM jobs").all() as Job[];

    // Check daemon heartbeat
    const heartbeat = db
      .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as { updated_at: number } | null;
    const isDaemonActive =
      heartbeat && Date.now() - heartbeat.updated_at < 65000; // 65 seconds threshold (daemon polls every 30s)

    if (isDaemonActive) {
      console.log(`\x1b[32m● Scheduler is active\x1b[0m\n`);
    } else {
      console.log(
        `\x1b[31m○ Scheduler is offline\x1b[0m (Run 'pyrunner install' to fix or 'pyrunner daemon' to start manually)\n`,
      );
    }

    if (jobs.length === 0) {
      console.log("No tasks found.");
      return;
    }

    console.table(
      jobs.map((j) => {
        const scriptExists = existsSync(j.script_path);
        return {
          Name: j.name,
          Status: j.status + (scriptExists ? "" : " (MISSING)"),
          Cron: j.cron,
          "Next Run": new Date(j.next_run_time).toLocaleString(),
          "Last Run": j.last_run_time
            ? new Date(j.last_run_time).toLocaleString()
            : "N/A",
          "Last Exit": j.last_exit_code ?? "N/A",
        };
      }),
    );
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
  .command("stop")
  .description("Stop running tasks (stops all if no name provided)")
  .argument("[name]", "Name of the task")
  .action((name) => {
    const db = getDb();

    if (name) {
      const job = db
        .prepare("SELECT * FROM jobs WHERE name = ?")
        .get(name) as Job | null;

      if (!job) {
        console.error(`Error: Task '${name}' not found.`);
        process.exit(1);
      }

      if (job.status !== "running") {
        console.log(`Task '${name}' is not currently running.`);
        return;
      }

      if (job.pid) {
        try {
          process.kill(job.pid, "SIGTERM");
          console.log(`Sent stop signal to task '${name}' (PID: ${job.pid}).`);
        } catch (e: any) {
          if (e.code === "ESRCH") {
            console.log(`Process for task '${name}' already exited.`);
          } else {
            console.error(`Failed to kill process: ${e.message}`);
          }
        }
      }

      db.prepare(
        "UPDATE jobs SET status = 'idle', pid = NULL WHERE name = ?",
      ).run(name);
      console.log(`Task '${name}' status reset to idle.`);
    } else {
      const runningJobs = db
        .query("SELECT * FROM jobs WHERE status = 'running'")
        .all() as Job[];

      if (runningJobs.length === 0) {
        console.log("No tasks are currently running.");
        return;
      }

      console.log(`Stopping ${runningJobs.length} running tasks...`);
      runningJobs.forEach((job) => {
        if (job.pid) {
          try {
            process.kill(job.pid, "SIGTERM");
            console.log(` - Stopped: ${job.name} (PID: ${job.pid})`);
          } catch (e) {
            // Ignore if already dead
          }
        }
      });

      db.prepare(
        "UPDATE jobs SET status = 'idle', pid = NULL WHERE status = 'running'",
      ).run();
      console.log("All running tasks have been stopped.");
    }
  });

program
  .command("run")
  .description(
    "Execute tasks immediately (runs all idle tasks if no name provided)",
  )
  .argument("[name]", "Name of the task")
  .action(async (name) => {
    const db = getDb();
    const { executeJob } = await import("./executor");

    if (name) {
      const job = db
        .prepare("SELECT * FROM jobs WHERE name = ?")
        .get(name) as Job | null;

      if (!job) {
        console.error(`Error: Task '${name}' not found.`);
        process.exit(1);
      }

      if (job.status === "running") {
        console.error(
          `Error: Task '${name}' is already running (PID: ${job.pid}).`,
        );
        process.exit(1);
      }

      console.log(`Manually triggering task: ${name}...`);
      await executeJob(job, false);
    } else {
      const jobs = db
        .query("SELECT * FROM jobs WHERE status != 'running'")
        .all() as Job[];

      if (jobs.length === 0) {
        console.log("No idle tasks found to run.");
        return;
      }

      console.log(`🚀 Manually triggering ${jobs.length} idle tasks...\n`);
      // Run all idle jobs in parallel
      await Promise.all(
        jobs.map((job) => {
          return executeJob(job, false).catch((err) => {
            console.error(`Error executing task ${job.name}:`, err);
          });
        }),
      );
      console.log("\nAll triggered tasks have completed.");
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
    const job = db
      .prepare("SELECT * FROM jobs WHERE name = ?")
      .get(name) as Job | null;

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

    db.prepare(
      `
      UPDATE jobs 
      SET script_path = ?, working_dir = ?, cron = ?, next_run_time = ? 
      WHERE name = ?
    `,
    ).run(scriptPath, workingDir, cron, nextRun, name);

    console.log(`Task '${name}' updated successfully.`);
    if (options.cron) {
      console.log(`New next run: ${new Date(nextRun).toLocaleString()}`);
    }
  });

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
  .action((name, options) => {
    const db = getDb();

    if (!name) {
      const jobs = db.query("SELECT name FROM jobs").all() as {
        name: string;
      }[];
      if (jobs.length === 0) {
        console.log("No tasks found.");
        return;
      }

      console.log("=== Last Execution Logs for All Tasks ===\n");
      jobs.forEach((job) => {
        const logPath = join(LOGS_DIR, `${job.name}.log`);
        if (!existsSync(logPath)) {
          process.stdout.write(`--- [${job.name}] ---\n(No logs found)\n\n`);
          return;
        }

        const buffer = readFileSync(logPath);
        process.stdout.write(`--- [${job.name}] ---\n`);

        // Find the last run in the buffer without full string conversion
        const content = buffer.toString("utf-8");
        const lines = content.trim().split("\n");
        let startIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (
            line &&
            (line.includes("--- RUN STARTED AT") ||
              line.includes("--- RUN FAILED AT"))
          ) {
            startIndex = i;
            break;
          }
        }

        const outputLines =
          startIndex !== -1 ? lines.slice(startIndex) : lines.slice(-5);
        // Write the lines as UTF-8 bytes directly
        process.stdout.write(
          Buffer.from(outputLines.join("\n") + "\n\n", "utf-8"),
        );
      });
      return;
    }

    const logPath = join(LOGS_DIR, `${name}.log`);
    if (!existsSync(logPath)) {
      console.error(`No logs found for task '${name}'.`);
      return;
    }

    const buffer = readFileSync(logPath);
    const content = buffer.toString("utf-8");
    const lines = content.trim().split("\n");

    if (options.tail) {
      const tailCount = parseInt(options.tail);
      if (lines.length > tailCount) {
        process.stdout.write(
          `... (showing last ${tailCount} of ${lines.length} lines) ...\n`,
        );
      }
      process.stdout.write(
        Buffer.from(lines.slice(-tailCount).join("\n") + "\n", "utf-8"),
      );
    } else {
      let startIndex = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (
          line &&
          (line.includes("--- RUN STARTED AT") ||
            line.includes("--- RUN FAILED AT"))
        ) {
          startIndex = i;
          break;
        }
      }

      if (startIndex !== -1) {
        if (startIndex > 0) {
          process.stdout.write(
            `... (showing full logs for the last execution, use -t <number> to see more history) ...\n`,
          );
        }
        process.stdout.write(
          Buffer.from(lines.slice(startIndex).join("\n") + "\n", "utf-8"),
        );
      } else {
        process.stdout.write(Buffer.from(lines.join("\n") + "\n", "utf-8"));
      }
    }
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
