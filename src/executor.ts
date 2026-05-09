import { join } from "node:path";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { LOGS_DIR } from "./config";
import { type Job, JobStatus } from "./db";
import { type Database } from "bun:sqlite";
import { calculateNextRun, decodeOutput } from "./utils";

function runProcess(job: Job) {
  return Bun.spawn(["uv", "run", job.script_path], {
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    cwd: job.working_dir,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/**
 * Main entry point for executing a job.
 * Orchestrates the lifecycle of a job run.
 */
export async function executeJob(db: Database, job: Job, isCatchup: boolean = false) {
  const logPath = join(LOGS_DIR, `${job.name}.log`);
  const startTime = Date.now();
  // Use the scheduled time as the base for the NEXT run calculation to avoid drift
  const baseTimeForNextRun = job.next_run_time || startTime;
  const runType = isCatchup ? "Catch-up" : "Scheduled";

  console.log(
    `[${new Date().toLocaleString()}] [${runType}] Starting job: ${job.name}`,
  );

  // 1. Validation
  if (!existsSync(job.script_path)) {
    return handleMissingScript(db, job, logPath, startTime, baseTimeForNextRun);
  }

  // 2. Preparation
  updateJobState(db, job.id!, JobStatus.Running, startTime);
  await appendFile(
    logPath,
    `\n--- RUN STARTED AT ${new Date(startTime).toLocaleString()} ---\n`,
  );

  let timeoutTimer: Timer | null = null;

  try {
    // 3. Execution
    const proc = runProcess(job);
    updateJobPid(db, job.id!, proc.pid);

    // Setup Timeout
    const timeoutMs = (job.timeout || 600) * 1000;
    timeoutTimer = setTimeout(() => {
      console.warn(`[${new Date().toLocaleString()}] Job ${job.name} timed out after ${timeoutMs / 1000}s. Killing...`);
      proc.kill();
      appendFile(logPath, `\nERROR: Job timed out after ${timeoutMs / 1000}s and was killed.\n`).catch(() => {});
    }, timeoutMs);

    // Streaming stdout/stderr to file
    const streamToLog = async (stream: ReadableStream) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Decode to string first to ensure the log file is unified UTF-8
          const text = decodeOutput(value);
          await appendFile(logPath, text);
        }
      } finally {
        reader.releaseLock();
      }
    };

    // Run streaming in parallel
    const [exitCode] = await Promise.all([
      proc.exited,
      streamToLog(proc.stdout),
      streamToLog(proc.stderr),
    ]);

    if (timeoutTimer) clearTimeout(timeoutTimer);

    // 4. Finalization
    const nextRun = calculateNextRun(job.cron, baseTimeForNextRun);
    finalizeJob(db, job.id!, exitCode, nextRun, JobStatus.Idle);

    await appendFile(
      logPath,
      `\n--- RUN FINISHED AT ${new Date().toLocaleString()} WITH EXIT CODE ${exitCode} ---\n`,
    );

    console.log(
      `[${new Date().toLocaleString()}] Finished job: ${job.name} (Exit: ${exitCode})`,
    );
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    await handleExecutionError(
      db,
      job,
      logPath,
      error instanceof Error ? error : new Error(String(error)),
      baseTimeForNextRun,
    );
  }
}

function updateJobState(db: Database, id: number, status: JobStatus, lastRun?: number) {
  if (lastRun) {
    db.prepare(
      "UPDATE jobs SET status = ?, last_run_time = ? WHERE id = ?",
    ).run(status, lastRun, id);
  } else {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }
}

function updateJobPid(db: Database, id: number, pid: number | null) {
  db.prepare("UPDATE jobs SET pid = ? WHERE id = ?").run(pid, id);
}

function finalizeJob(
  db: Database,
  id: number,
  exitCode: number,
  nextRun: number,
  status: JobStatus,
) {
  db.prepare(
    "UPDATE jobs SET status = ?, last_exit_code = ?, next_run_time = ?, pid = NULL WHERE id = ?",
  ).run(status, exitCode, nextRun, id);
}

async function handleMissingScript(
  db: Database,
  job: Job,
  logPath: string,
  startTime: number,
  baseTime: number,
) {
  const errorMsg = `Error: Script not found at ${job.script_path}`;
  await appendFile(
    logPath,
    `\n--- RUN FAILED AT ${new Date(startTime).toLocaleString()} ---\n${errorMsg}\n`,
  ).catch(() => {});

  const nextRun = calculateNextRun(job.cron, baseTime);
  db.prepare(
    "UPDATE jobs SET status = ?, last_run_time = ?, next_run_time = ? WHERE id = ?",
  ).run(JobStatus.MissingScript, startTime, nextRun, job.id!);

  console.error(
    `[${new Date().toLocaleString()}] Job failed: ${job.name} - Script missing`,
  );
}

async function handleExecutionError(
  db: Database,
  job: Job,
  logPath: string,
  error: Error,
  baseTime: number,
) {
  const endTime = Date.now();
  await appendFile(
    logPath,
    `\n--- RUN FAILED AT ${new Date(endTime).toLocaleString()} ---\nERROR: ${error.message}\n`,
  ).catch(() => {});

  const nextRun = calculateNextRun(job.cron, baseTime);
  db.prepare("UPDATE jobs SET status = ?, next_run_time = ? WHERE id = ?")
    .run(JobStatus.Failed, nextRun, job.id!);

  console.error(
    `[${new Date().toLocaleString()}] Job failed: ${job.name}`,
    error,
  );
}
