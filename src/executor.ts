import { $ } from "bun";
import { join } from "node:path";
import { appendFileSync, existsSync } from "node:fs";
import { LOGS_DIR } from "./config";
import { getDb, type Job, JobStatus } from "./db";
import { CronExpressionParser } from "cron-parser";

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
    const result = await runProcess(job);

    // 4. Finalization
    const nextRun = calculateNextRun(job.cron);
    finalizeJob(job.id!, result.exitCode, nextRun, JobStatus.Idle);

    const stdout = decodeOutput(result.stdout);
    const stderr = decodeOutput(result.stderr);
    appendFileSync(logPath, stdout);
    appendFileSync(logPath, stderr);
    appendFileSync(logPath, `\n--- RUN FINISHED AT ${new Date().toLocaleString()} WITH EXIT CODE ${result.exitCode} ---\n`);

    console.log(`[${new Date().toLocaleString()}] Finished job: ${job.name} (Exit: ${result.exitCode})`);
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
 * Decodes a buffer to string using UTF-8.
 * Falls back to lossy decoding if invalid sequences are encountered.
 */
export function decodeOutput(buffer: Uint8Array): string {
  if (buffer.length === 0) return "";
  return new TextDecoder("utf-8").decode(buffer);
}

// --- Helper Functions ---

async function runProcess(job: Job) {
  return await $`uv run ${job.script_path}`
    .env({
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
    })
    .cwd(job.working_dir)
    .quiet()
    .nothrow();
}

function updateJobState(id: number, status: JobStatus, lastRun?: number) {
  const db = getDb();
  if (lastRun) {
    db.prepare("UPDATE jobs SET status = ?, last_run_time = ? WHERE id = ?").run(status, lastRun, id);
  } else {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }
}

function finalizeJob(id: number, exitCode: number, nextRun: number, status: JobStatus) {
  getDb()
    .prepare("UPDATE jobs SET status = ?, last_exit_code = ?, next_run_time = ? WHERE id = ?")
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
