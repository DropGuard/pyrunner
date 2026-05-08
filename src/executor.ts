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
      PYTHONIOENCODING: "utf-8"
    },
    cwd: job.working_dir,
    stdout: "pipe",
    stderr: "pipe"
  });
}

/**
 * Main entry point for executing a job.
 * Orchestrates the lifecycle of a job run.
 */
export async function executeJob(job: Job, isCatchup: boolean = false) {
  const logPath = join(LOGS_DIR, `${job.name}.log`);
  const startTime = Date.now();
  const runType = isCatchup ? "Catch-up" : "Scheduled";

  console.log(`[${new Date().toLocaleString()}] [${runType}] Starting job: ${job.name}`);

  // 1. Validation
  if (!existsSync(job.script_path)) {
    return handleMissingScript(job, logPath, startTime);
  }

  // 2. Preparation
  updateJobState(job.id!, JobStatus.Running, startTime);
  appendFileSync(logPath, `\n--- RUN STARTED AT ${new Date(startTime).toLocaleString()} ---\n`);

  try {
    // 3. Execution
    const proc = runProcess(job);
    updateJobPid(job.id!, proc.pid);

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).arrayBuffer();
    const stderr = await new Response(proc.stderr).arrayBuffer();

    // 4. Finalization
    const nextRun = calculateNextRun(job.cron);
    finalizeJob(job.id!, exitCode, nextRun, JobStatus.Idle);

    appendFileSync(logPath, decodeOutput(new Uint8Array(stdout)));
    appendFileSync(logPath, decodeOutput(new Uint8Array(stderr)));
    appendFileSync(logPath, `\n--- RUN FINISHED AT ${new Date().toLocaleString()} WITH EXIT CODE ${exitCode} ---\n`);

    console.log(`[${new Date().toLocaleString()}] Finished job: ${job.name} (Exit: ${exitCode})`);
  } catch (error: any) {
    handleExecutionError(job, logPath, error);
  }
}

/**
 * Calculates the next execution time based on a cron expression.
 */
export function calculateNextRun(cron: string): number {
  return CronExpressionParser.parse(cron).next().getTime();
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
    db.prepare("UPDATE jobs SET status = ?, last_run_time = ? WHERE id = ?").run(status, lastRun, id);
  } else {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }
}

function updateJobPid(id: number, pid: number | null) {
  getDb().prepare("UPDATE jobs SET pid = ? WHERE id = ?").run(pid, id);
}

function finalizeJob(id: number, exitCode: number, nextRun: number, status: JobStatus) {
  getDb()
    .prepare("UPDATE jobs SET status = ?, last_exit_code = ?, next_run_time = ?, pid = NULL WHERE id = ?")
    .run(status, exitCode, nextRun, id);
}

function handleMissingScript(job: Job, logPath: string, startTime: number) {
  const errorMsg = `Error: Script not found at ${job.script_path}`;
  appendFileSync(logPath, `\n--- RUN FAILED AT ${new Date(startTime).toLocaleString()} ---\n${errorMsg}\n`);

  const nextRun = calculateNextRun(job.cron);
  getDb()
    .prepare("UPDATE jobs SET status = ?, last_run_time = ?, next_run_time = ? WHERE id = ?")
    .run(JobStatus.MissingScript, startTime, nextRun, job.id!);

  console.error(`[${new Date().toLocaleString()}] Job failed: ${job.name} - Script missing`);
}

function handleExecutionError(job: Job, logPath: string, error: any) {
  const endTime = Date.now();
  appendFileSync(logPath, `\n--- RUN FAILED AT ${new Date(endTime).toLocaleString()} ---\nERROR: ${error.message}\n`);

  updateJobState(job.id!, JobStatus.Failed);
  console.error(`[${new Date().toLocaleString()}] Job failed: ${job.name}`, error);
}
