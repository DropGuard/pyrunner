import { appendFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JobRepository } from "@/db/job-repository";
import type { Config } from "@/shared/config";
import { type Job, JobStatus } from "@/shared/types";
import { calculateNextRun } from "@/utils/cron";
import { logger } from "@/utils/logger";
import { killProcessTree, SmartDecoder } from "@/utils/process";

function runProcess(job: Job) {
  return Bun.spawn(["uv", "run", job.script_path], {
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    cwd: dirname(job.script_path),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
}

export async function executeJob(
  repo: JobRepository,
  job: Job,
  config: Config,
  options?: { truncateLog?: boolean },
) {
  const logPath = join(config.logsDir, `${job.name}.log`);
  const startTime = Date.now();

  const isDue = job.next_run_time <= startTime;
  const baseTimeForNextRun = job.next_run_time || startTime;
  const runType = isDue ? "Scheduled" : "Manual";

  logger.info(`[${runType}] Starting job: ${job.name}`);

  const writeToLog = async (content: string | Uint8Array) => {
    await appendFile(logPath, content);
  };

  if (!(await Bun.file(job.script_path).exists())) {
    logger.error(`Script not found for ${job.name}: ${job.script_path}`);
    const nextRun = isDue ? calculateNextRun(job.cron, startTime) : job.next_run_time;
    await repo.finalize(job.id, -1, nextRun, JobStatus.MissingScript);
    await writeToLog(`\nERROR: Script not found at ${job.script_path}\n`);
    return;
  }

  if (options?.truncateLog) {
    try {
      await Bun.write(logPath, "");
    } catch (_e: any) {
      // Ignore if log file doesn't exist yet
    }
  } else {
    try {
      const size = Bun.file(logPath).size;
      if (size > 5 * 1024 * 1024) {
        // 5MB limit
        await rename(logPath, `${logPath}.old`);
      }
    } catch (_e: any) {
      // Ignore if file doesn't exist or rename fails
    }
  }
  await writeToLog(
    `\n================================================================================\n` +
      `[RUN STARTED] | Type: ${runType} | Time: ${new Date(startTime).toLocaleString()}\n` +
      `================================================================================\n`,
  );

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const proc = runProcess(job);
    await repo.updatePid(job.id, proc.pid);
    const timeoutMs = config.defaultTimeout * 1000;

    timeoutTimer = setTimeout(async () => {
      logger.warn(`Job ${job.name} timed out after ${timeoutMs / 1000}s. Killing tree...`);
      await killProcessTree(proc.pid);
      await writeToLog(`\n[TIMEOUT] Job exceeded ${timeoutMs / 1000}s and was killed.\n`);
    }, timeoutMs);

    // Use a write queue to prevent interleaving of stdout/stderr
    let writeQueue = Promise.resolve();
    let writtenBytes = 0;
    const MAX_RUN_BYTES = 10 * 1024 * 1024; // 10MB per run limit
    let truncatedWarningPrinted = false;

    const queuedWriteToLog = (text: string) => {
      const bytes = Buffer.byteLength(text);
      if (writtenBytes > MAX_RUN_BYTES) {
        if (!truncatedWarningPrinted) {
          truncatedWarningPrinted = true;
          writeQueue = writeQueue.then(() =>
            writeToLog("\n[LOG TRUNCATED: Exceeded 10MB limit]\n"),
          );
        }
        return writeQueue;
      }
      writtenBytes += bytes;
      writeQueue = writeQueue.then(() => writeToLog(text));
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
            if (final) await queuedWriteToLog(final);
            break;
          }
          const text = decoder.decode(value);
          await queuedWriteToLog(text);
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

    const nextRun = isDue ? calculateNextRun(job.cron, startTime) : job.next_run_time;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    await repo.finalize(job.id, exitCode, nextRun, JobStatus.Idle);

    await writeToLog(
      `--------------------------------------------------------------------------------\n` +
        `[RUN FINISHED] | Status: ${exitCode === 0 ? "Success" : "Failed"} | Duration: ${duration}s | Exit Code: ${exitCode} | Time: ${new Date().toLocaleString()}\n` +
        `--------------------------------------------------------------------------------\n`,
    );

    if (exitCode === 0) {
      logger.success(`Job ${job.name} completed successfully.`);
    } else {
      logger.error(`Job ${job.name} failed with exit code ${exitCode}.`);
    }
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    logger.error(`Unexpected error executing job ${job.name}:`, error);

    const nextRun = isDue ? calculateNextRun(job.cron, startTime) : job.next_run_time;
    await repo.finalize(job.id, -1, nextRun, JobStatus.Failed);

    await writeToLog(
      `\nERROR: Unexpected error during execution: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
