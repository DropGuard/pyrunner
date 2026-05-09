import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { isDaemonActive, type Job, JobStatus } from "./db";
import { executeJob } from "./executor";
import { LOGS_DIR } from "./config";
import { type Database } from "bun:sqlite";
import { calculateNextRun, decodeOutput } from "./utils";

export function addJob(db: Database, name: string, script: string, cron: string, options?: { timeout?: string }) {
  const absolutePath = resolve(process.cwd(), script);
  const workingDir = dirname(absolutePath);

  if (!existsSync(absolutePath)) {
    console.error(`Error: Script not found at ${absolutePath}`);
    process.exit(1);
  }

  const timeout = options?.timeout ? parseInt(options.timeout) : 600;

  try {
    const nextRun = calculateNextRun(cron);
    db.prepare(
      `
      INSERT INTO jobs (name, script_path, working_dir, cron, timeout, next_run_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(name, absolutePath, workingDir, cron, timeout, nextRun, Date.now());

    console.log(`Task '${name}' added successfully using cron: '${cron}'`);
    console.log(`Next run: ${new Date(nextRun).toLocaleString()}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
      console.error(`Error: A task named '${name}' already exists.`);
    } else {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(1);
  }
}

export function listJobs(db: Database) {
  const jobs = db.query("SELECT * FROM jobs").all() as Job[];

  if (isDaemonActive(db)) {
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
        ID: j.id,
        Name: j.name,
        Status: j.status + (scriptExists ? "" : " (MISSING)"),
        Cron: j.cron,
        Timeout: (j.timeout ?? 600) + "s",
        "Next Run": new Date(j.next_run_time).toLocaleString(),
        "Last Run": j.last_run_time
          ? new Date(j.last_run_time).toLocaleString()
          : "N/A",
      };
    }),
  );
}

export function removeJob(db: Database, name: string) {
  const result = db.prepare("DELETE FROM jobs WHERE name = ?").run(name);
  if (result.changes > 0) {
    console.log(`Task '${name}' removed.`);
  } else {
    console.log(`Task '${name}' not found.`);
  }
}

export function stopJob(db: Database, name?: string) {
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
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "ESRCH") {
          console.log(`Process for task '${name}' already exited.`);
        } else {
          console.error(`Failed to kill process: ${e instanceof Error ? e.message : String(e)}`);
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
}

export async function runJob(db: Database, name?: string) {
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
    await executeJob(db, job, false);
  } else {
    const jobs = db
      .query("SELECT * FROM jobs WHERE status != 'running'")
      .all() as Job[];

    if (jobs.length === 0) {
      console.log("No idle tasks found to run.");
      return;
    }

    console.log(`🚀 Manually triggering ${jobs.length} idle tasks...\n`);
    await Promise.all(
      jobs.map((job) => {
        return executeJob(db, job, false).catch((err) => {
          console.error(`Error executing task ${job.name}:`, err);
        });
      }),
    );
    console.log("\nAll triggered tasks have completed.");
  }
}

export function editJob(db: Database, name: string, options: { script?: string; cron?: string; timeout?: string }) {
  const job = db
    .prepare("SELECT * FROM jobs WHERE name = ?")
    .get(name) as Job | null;

  if (!job) {
    console.error(`Error: Task '${name}' not found.`);
    process.exit(1);
  }

  if (!options.script && !options.cron && !options.timeout) {
    console.log("No changes specified. Use --script, --cron or --timeout.");
    return;
  }

  let scriptPath = job.script_path;
  let workingDir = job.working_dir;
  let cron = job.cron;
  let timeout = job.timeout || 600;
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
    } catch (e) {
      console.error(`Error: Invalid cron expression '${cron}'`);
      process.exit(1);
    }
  }

  if (options.timeout) {
    timeout = parseInt(options.timeout);
  }

  db.prepare(
    `
    UPDATE jobs 
    SET script_path = ?, working_dir = ?, cron = ?, timeout = ?, next_run_time = ? 
    WHERE name = ?
  `,
  ).run(scriptPath, workingDir, cron, timeout, nextRun, name);

  console.log(`Task '${name}' updated successfully.`);
  if (options.cron) {
    console.log(`New next run: ${new Date(nextRun).toLocaleString()}`);
  }
}

export async function showLogs(db: Database, name?: string, options?: { tail?: string }) {
  async function printLogTail(filePath: string, taskName: string, tailLines?: number) {
    if (!existsSync(filePath)) {
      if (!tailLines) process.stdout.write(`--- [${taskName}] ---\n(No logs found)\n\n`);
      return;
    }

    const file = Bun.file(filePath);
    const bufferSize = tailLines ? Math.max(tailLines * 200, 65536) : 65536;
    const start = Math.max(0, file.size - bufferSize);
    const blob = file.slice(start);
    const buffer = new Uint8Array(await blob.arrayBuffer());
    
    // Use the smart decoder to handle potential GBK/UTF-8 mix
    const content = decodeOutput(buffer);
    const lines = content.trim().split("\n");

    if (tailLines) {
      const outputLines = lines.slice(-tailLines);
      if (lines.length >= tailLines && start > 0) {
        process.stdout.write(`... (showing last ${tailLines} lines) ...\n`);
      }
      process.stdout.write(outputLines.join("\n") + "\n");
    } else {
      let startIndex = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line && (line.includes("--- RUN STARTED AT") || line.includes("--- RUN FAILED AT"))) {
          startIndex = i;
          break;
        }
      }

      const outputLines = startIndex !== -1 ? lines.slice(startIndex) : lines.slice(-10);
      process.stdout.write(`--- [${taskName}] ---\n`);
      process.stdout.write(outputLines.join("\n") + "\n\n");
    }
  }

  if (!name) {
    const jobs = db.query("SELECT name FROM jobs").all() as { name: string }[];
    if (jobs.length === 0) {
      console.log("No tasks found.");
      return;
    }
    console.log("=== Last Execution Logs for All Tasks ===\n");
    for (const job of jobs) {
      await printLogTail(join(LOGS_DIR, `${job.name}.log`), job.name);
    }
    return;
  }

  await printLogTail(join(LOGS_DIR, `${name}.log`), name, options?.tail ? parseInt(options.tail) : undefined);
}
