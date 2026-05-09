import { join } from "node:path";
import { appendFileSync, existsSync } from "node:fs";
import { LOGS_DIR } from "./config";
import { getDb, type Job, JobStatus } from "./db";
import { CronExpressionParser } from "cron-parser";

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
export async function executeJob(job: Job, isCatchup: boolean = false) {
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
    return handleMissingScript(job, logPath, startTime, baseTimeForNextRun);
  }

  // 2. Preparation
  // Note: Atomic status update should have happened in the daemon before calling this
  updateJobState(job.id!, JobStatus.Running, startTime);
  appendFileSync(
    logPath,
    `\n--- RUN STARTED AT ${new Date(startTime).toLocaleString()} ---\n`,
  );

  let timeoutTimer: Timer | null = null;

  try {
    // 3. Execution
    const proc = runProcess(job);
    updateJobPid(job.id!, proc.pid);

    // Setup Timeout
    const timeoutMs = (job.timeout || 600) * 1000;
    timeoutTimer = setTimeout(() => {
      console.warn(`[${new Date().toLocaleString()}] Job ${job.name} timed out after ${timeoutMs / 1000}s. Killing...`);
      proc.kill();
      appendFileSync(logPath, `\nERROR: Job timed out after ${timeoutMs / 1000}s and was killed.\n`);
    }, timeoutMs);

    // Streaming stdout/stderr to file
    const streamToLog = async (stream: ReadableStream) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          appendFileSync(logPath, decodeOutput(value));
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
    finalizeJob(job.id!, exitCode, nextRun, JobStatus.Idle);

    appendFileSync(
      logPath,
      `\n--- RUN FINISHED AT ${new Date().toLocaleString()} WITH EXIT CODE ${exitCode} ---\n`,
    );

    console.log(
      `[${new Date().toLocaleString()}] Finished job: ${job.name} (Exit: ${exitCode})`,
    );
  } catch (error: any) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    handleExecutionError(job, logPath, error, baseTimeForNextRun);
  }
}

/**
 * Calculates the next execution time based on a cron expression.
 * @param cron The cron expression
 * @param baseTime Optional base time. If provided, calculates next run AFTER this time.
 */
export function calculateNextRun(cron: string, baseTime?: number): number {
  const options = baseTime ? { currentDate: new Date(baseTime) } : {};
  return CronExpressionParser.parse(cron, options).next().getTime();
}

/**
 * Decodes a buffer to string using an intelligent fallback.
 * Checks for valid UTF-8 sequences; if invalid, assumes GBK (common on Windows).
 */
export function decodeOutput(buffer: Uint8Array): string {
  if (buffer.length === 0) return "";

  // Try UTF-8 first
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8Decoder.decode(buffer);
  } catch (e) {
    // Fall back to GBK
    try {
      // @ts-expect-error - "gbk" is supported by Bun/Node but might not be in the standard Encoding type
      return new TextDecoder("gbk").decode(buffer);
    } catch (e2) {
      // Last resort fallback
      return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }
  }
}

function updateJobState(id: number, status: JobStatus, lastRun?: number) {
  const db = getDb();
  if (lastRun) {
    db.prepare(
      "UPDATE jobs SET status = ?, last_run_time = ? WHERE id = ?",
    ).run(status, lastRun, id);
  } else {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }
}

function updateJobPid(id: number, pid: number | null) {
  getDb().prepare("UPDATE jobs SET pid = ? WHERE id = ?").run(pid, id);
}

function finalizeJob(
  id: number,
  exitCode: number,
  nextRun: number,
  status: JobStatus,
) {
  getDb()
    .prepare(
      "UPDATE jobs SET status = ?, last_exit_code = ?, next_run_time = ?, pid = NULL WHERE id = ?",
    )
    .run(status, exitCode, nextRun, id);
}

function handleMissingScript(
  job: Job,
  logPath: string,
  startTime: number,
  baseTime: number,
) {
  const errorMsg = `Error: Script not found at ${job.script_path}`;
  appendFileSync(
    logPath,
    `\n--- RUN FAILED AT ${new Date(startTime).toLocaleString()} ---\n${errorMsg}\n`,
  );

  const nextRun = calculateNextRun(job.cron, baseTime);
  getDb()
    .prepare(
      "UPDATE jobs SET status = ?, last_run_time = ?, next_run_time = ? WHERE id = ?",
    )
    .run(JobStatus.MissingScript, startTime, nextRun, job.id!);

  console.error(
    `[${new Date().toLocaleString()}] Job failed: ${job.name} - Script missing`,
  );
}

function handleExecutionError(
  job: Job,
  logPath: string,
  error: any,
  baseTime: number,
) {
  const endTime = Date.now();
  appendFileSync(
    logPath,
    `\n--- RUN FAILED AT ${new Date(endTime).toLocaleString()} ---\nERROR: ${error.message}\n`,
  );

  const nextRun = calculateNextRun(job.cron, baseTime);
  getDb()
    .prepare("UPDATE jobs SET status = ?, next_run_time = ? WHERE id = ?")
    .run(JobStatus.Failed, nextRun, job.id!);

  console.error(
    `[${new Date().toLocaleString()}] Job failed: ${job.name}`,
    error,
  );
}
