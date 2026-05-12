import { stat } from "node:fs/promises";
import { appendFile, truncate } from "node:fs/promises";
import { join } from "node:path";
import type { JobRepository } from "../db/job-repository";
import { DEFAULT_TIMEOUT, LOGS_DIR } from "../shared/config";
import { type Job, JobStatus } from "../shared/types";
import { calculateNextRun } from "../utils/cron";
import { logger } from "../utils/logger";
import { killProcessTree, SmartDecoder } from "../utils/process";

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
    windowsHide: true,
  });
}

export async function executeJob(
  repo: JobRepository,
  job: Job,
  options?: { truncateLog?: boolean },
) {
  const logPath = join(LOGS_DIR, `${job.name}.log`);
  const startTime = Date.now();

  const isDue = job.next_run_time <= startTime;
  const baseTimeForNextRun = job.next_run_time || startTime;
  const runType = isDue ? "Scheduled" : "Manual";

  logger.info(`[${runType}] Starting job: ${job.name}`);

  try {
    await stat(job.script_path);
  } catch (e: any) {
    logger.error(`Script not found for ${job.name}: ${job.script_path}`);
    const nextRun = isDue ? calculateNextRun(job.cron, baseTimeForNextRun) : job.next_run_time;
    await repo.finalize(job.id, -1, nextRun, JobStatus.MissingScript);
    await appendFile(logPath, `\nERROR: Script not found at ${job.script_path}\n`);
    return;
  }

  if (options?.truncateLog) {
    try {
      await truncate(logPath, 0);
    } catch (e: any) {
      // Ignore if log file doesn't exist yet
    }
  }
  await appendFile(logPath, `\n--- RUN STARTED AT ${new Date(startTime).toLocaleString()} ---\n`);

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const proc = runProcess(job);
    await repo.updatePid(job.id, proc.pid);

    const timeoutMs = (job.timeout || DEFAULT_TIMEOUT) * 1000;
    timeoutTimer = setTimeout(async () => {
      logger.warn(`Job ${job.name} timed out after ${timeoutMs / 1000}s. Killing tree...`);
      await killProcessTree(proc.pid);
      await appendFile(
        logPath,
        `\nERROR: Job timed out after ${timeoutMs / 1000}s and was killed.\n`,
      );
    }, timeoutMs);

    // Use a write queue to prevent interleaving of stdout/stderr
    const encoder = new TextEncoder();
    let writeQueue = Promise.resolve();
    const writeToLog = (text: string) => {
      writeQueue = writeQueue.then(() => appendFile(logPath, encoder.encode(text)));
      return writeQueue;
    };

    const streamToLog = async (stream: ReadableStream) => {
      const reader = stream.getReader();
      const decoder = new SmartDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const final = decoder.decode(new Uint8Array(0), true);
            if (final) await writeToLog(final);
            break;
          }
          const text = decoder.decode(value);
          await writeToLog(text);
        }
      } finally {
        reader.releaseLock();
      }
    };

    const [exitCode] = await Promise.all([
      proc.exited,
      streamToLog(proc.stdout),
      streamToLog(proc.stderr),
    ]);

    if (timeoutTimer) clearTimeout(timeoutTimer);

    const nextRun = isDue ? calculateNextRun(job.cron, baseTimeForNextRun) : job.next_run_time;
    await repo.finalize(job.id, exitCode, nextRun, JobStatus.Idle);

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
    await repo.finalize(job.id, -1, nextRun, JobStatus.Failed);
    
    await appendFile(
      logPath,
      `\nERROR: Unexpected error during execution: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
