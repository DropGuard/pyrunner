import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { isDaemonActive, JobStatus, type JobRepository } from "./db";
import { executeJob } from "./executor";
import { LOGS_DIR, DEFAULT_TIMEOUT, DAEMON_LOCK_PATH } from "./config";
import { logger, calculateNextRun, killProcessTree, decodeOutput } from "./utils";

export function addJob(repo: JobRepository, name: string, script: string, cron: string) {
  const absolutePath = resolve(process.cwd(), script);
  const workingDir = dirname(absolutePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Script not found at ${absolutePath}`);
  }

  try {
    const nextRun = calculateNextRun(cron);
    repo.add({
      name,
      script_path: absolutePath,
      working_dir: workingDir,
      cron,
      timeout: DEFAULT_TIMEOUT,
      next_run_time: nextRun,
    });

    logger.success(`Task '${name}' added successfully using cron: '${cron}'`);
    logger.info(`Next run: ${new Date(nextRun).toLocaleString()}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
      throw new Error(`A task named '${name}' already exists.`);
    }
    throw e;
  }
}

export function listJobs(repo: JobRepository) {
  const jobs = repo.getAll();

  if (isDaemonActive()) {
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
      };
    }),
  );
}

export function removeJob(repo: JobRepository, name: string) {
  if (repo.delete(name)) {
    logger.success(`Task '${name}' removed.`);
  } else {
    logger.warn(`Task '${name}' not found.`);
  }
}

export async function stopDaemon() {
  if (!isDaemonActive()) {
    logger.info("Scheduler is already offline.");
    return;
  }

  try {
    const lockContent = await Bun.file(DAEMON_LOCK_PATH).text();
    const pid = parseInt(lockContent.trim());
    if (!isNaN(pid)) {
      logger.info(`Stopping scheduler daemon (PID: ${pid})...`);
      await killProcessTree(pid);
      logger.success("Scheduler daemon stopped.");
    }
  } catch (e) {
    logger.error("Failed to stop daemon:", e);
  }
}

export async function killTasks(repo: JobRepository, name?: string) {
  if (name) {
    const job = repo.getByName(name);
    if (!job) throw new Error(`Task '${name}' not found.`);
    if (job.status !== JobStatus.Running || !job.pid) {
      logger.info(`Task '${name}' is not currently running.`);
      return;
    }

    logger.info(`Killing task '${name}' (PID: ${job.pid})...`);
    await killProcessTree(job.pid);
    repo.finalize(job.id!, -1, job.next_run_time, JobStatus.Idle);
    logger.success(`Task '${name}' killed.`);
  } else {
    const jobs = repo.getAll().filter(j => j.status === JobStatus.Running && j.pid);
    if (jobs.length === 0) {
      logger.info("No running tasks to kill.");
      return;
    }

    logger.info(`Killing ${jobs.length} running tasks...`);
    for (const job of jobs) {
      logger.info(` - Killing '${job.name}' (PID: ${job.pid})...`);
      await killProcessTree(job.pid!);
      repo.finalize(job.id!, -1, job.next_run_time, JobStatus.Idle);
    }
    logger.success(`Killed all tasks.`);
  }
}

export async function runJob(repo: JobRepository, name?: string) {
  if (name) {
    const job = repo.getByName(name);
    if (!job) throw new Error(`Task '${name}' not found.`);

    if (job.status === JobStatus.Running) {
      logger.warn(`Task '${name}' is already running.`);
      return;
    }

    logger.info(`Manually triggering task: ${name}...`);
    await executeJob(repo, job, false, { truncateLog: true });
  } else {
    const jobs = repo.getAll().filter(j => j.status !== JobStatus.Running);
    if (jobs.length === 0) {
      logger.info("No idle tasks found to run.");
      return;
    }

    logger.info(`🚀 Manually triggering ${jobs.length} idle tasks...\n`);
    // Run them in parallel but handle errors gracefully
    await Promise.all(
      jobs.map((job) => {
        return executeJob(repo, job, false, { truncateLog: true }).catch((err) => {
          logger.error(`Error executing task ${job.name}:`, err);
        });
      })
    );
    logger.info("\nAll triggered tasks have completed.");
  }
}

export function editJob(repo: JobRepository, name: string, options: { script?: string; cron?: string }) {
  const job = repo.getByName(name);
  if (!job) throw new Error(`Task '${name}' not found.`);

  const updates: Partial<Pick<Job, "script_path" | "working_dir" | "cron" | "next_run_time">> = {};

  if (options.script) {
    const absPath = resolve(process.cwd(), options.script);
    if (!existsSync(absPath)) throw new Error(`Script not found at ${absPath}`);
    updates.script_path = absPath;
    updates.working_dir = dirname(absPath);
  }

  if (options.cron) {
    updates.cron = options.cron;
    updates.next_run_time = calculateNextRun(options.cron);
  }

  if (Object.keys(updates).length === 0) {
    logger.info("No changes specified.");
    return;
  }

  repo.update(name, updates);
  logger.success(`Task '${name}' updated.`);
}

/**
 * Intelligent log viewer.
 */
export async function showLogs(repo: JobRepository, name?: string, options?: { lines?: string }) {
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
    const jobs = repo.getAll();
    if (jobs.length === 0) {
      logger.info("No tasks found.");
      return;
    }
    process.stdout.write("\x1b[36m=== Last Execution Logs for All Tasks ===\x1b[0m\n\n");
    for (const job of jobs) {
      await printLogTail(join(LOGS_DIR, `${job.name}.log`), job.name);
    }
  } else {
    const job = repo.getByName(name);
    if (!job) throw new Error(`Task '${name}' not found.`);
    await printLogTail(join(LOGS_DIR, `${name}.log`), name, options?.lines ? parseInt(options.lines) : undefined);
  }
}
