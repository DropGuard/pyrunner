import { join } from "node:path";
import { existsSync } from "node:fs";
import { appendFile, truncate } from "node:fs/promises";
import { LOGS_DIR, DEFAULT_TIMEOUT } from "./config";
import { type Job, JobStatus, type JobRepository } from "./db";
import { calculateNextRun, SmartDecoder, logger, killProcessTree } from "./utils";

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
export async function executeJob(repo: JobRepository, job: Job, isCatchup: boolean = false, options?: { truncateLog?: boolean }) {
  const logPath = join(LOGS_DIR, `${job.name}.log`);
  const startTime = Date.now();
  
  // If manual run happens BEFORE next scheduled time, don't advance the schedule.
  // Otherwise, advance from the expected next_run_time (or current time if missing).
  const isDue = job.next_run_time <= startTime;
  const baseTimeForNextRun = job.next_run_time || startTime;
  const runType = isCatchup ? "Catch-up" : (isDue ? "Scheduled" : "Manual");

  logger.info(`[${runType}] Starting job: ${job.name}`);

  // 1. Validation
  if (!existsSync(job.script_path)) {
    logger.error(`Script not found for ${job.name}: ${job.script_path}`);
    const nextRun = isDue ? calculateNextRun(job.cron, baseTimeForNextRun) : job.next_run_time;
    repo.finalize(job.id!, -1, nextRun, JobStatus.MissingScript);
    await appendFile(logPath, `\nERROR: Script not found at ${job.script_path}\n`);
    return;
  }

  // 2. Preparation
  if (options?.truncateLog && existsSync(logPath)) {
    await truncate(logPath, 0);
  }
  await appendFile(
    logPath,
    `\n--- RUN STARTED AT ${new Date(startTime).toLocaleString()} ---\n`,
  );

  let timeoutTimer: Timer | null = null;

  try {
    // 3. Execution
    const proc = runProcess(job);
    repo.updatePid(job.id!, proc.pid);

    // Setup Timeout
    const timeoutMs = (job.timeout || DEFAULT_TIMEOUT) * 1000;
    timeoutTimer = setTimeout(async () => {
      logger.warn(`Job ${job.name} timed out after ${timeoutMs / 1000}s. Killing tree...`);
      await killProcessTree(proc.pid);
      await appendFile(logPath, `\nERROR: Job timed out after ${timeoutMs / 1000}s and was killed.\n`);
    }, timeoutMs);

    // Streaming stdout/stderr to file
    const encoder = new TextEncoder();
    const streamToLog = async (stream: ReadableStream) => {
      const reader = stream.getReader();
      const decoder = new SmartDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const final = decoder.decode(new Uint8Array(0), true);
            if (final) await appendFile(logPath, encoder.encode(final));
            break;
          }
          const text = decoder.decode(value);
          await appendFile(logPath, encoder.encode(text));
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
    // Only advance the schedule if it was a due run.
    const nextRun = isDue ? calculateNextRun(job.cron, baseTimeForNextRun) : job.next_run_time;
    repo.finalize(job.id!, exitCode, nextRun, JobStatus.Idle);
    
    await appendFile(
      logPath,
      `--- RUN FINISHED AT ${new Date().toLocaleString()} WITH EXIT CODE ${exitCode} ---\n`,
    );
    
    if (exitCode === 0) {
      logger.success(`Job ${job.name} completed successfully.`);
    } else {
      logger.error(`Job ${job.name} failed with exit code ${exitCode}.`);
    }
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    logger.error(`Unexpected error executing job ${job.name}:`, error);
    const nextRun = isDue ? calculateNextRun(job.cron, baseTimeForNextRun) : job.next_run_time;
    repo.finalize(job.id!, -1, nextRun, JobStatus.Failed);
  }
}
