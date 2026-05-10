import { ensureEnv, HEARTBEAT_INTERVAL, DAEMON_LOCK_PATH } from "./config";
import { createDb, JobStatus, JobRepository } from "./db";
import { executeJob } from "./executor";
import { logger, hideConsole } from "./utils";
import { writeFileSync, unlinkSync } from "node:fs";

export async function tick(repo: JobRepository, isInitial: boolean = false): Promise<number> {
  try {
    const now = Date.now();
    const dueJobs = repo.getDueJobs(now);

    if (dueJobs.length > 0) {
      const type = isInitial ? "Catch-up" : "Scheduled";
      logger.info(`[${type}] Found ${dueJobs.length} due jobs. Attempting to start...`);
      
      for (const job of dueJobs) {
        // Atomic status update
        const updated = repo.markAsRunning(job.id!);
        if (updated) {
          executeJob(repo, updated, isInitial).catch((err) => {
            logger.error(`Unhandled error in job ${updated.name}:`, err);
          });
        }
      }
    }

    // Return time until the NEXT job needs to run
    const allJobs = repo.getAll();
    if (allJobs.length === 0) return HEARTBEAT_INTERVAL * 60; // Sleep 1min if no jobs
    
    const nextRun = Math.min(...allJobs.map(j => j.next_run_time));
    return Math.max(HEARTBEAT_INTERVAL, nextRun - Date.now());

  } catch (error) {
    logger.error("Error during daemon tick:", error);
    return HEARTBEAT_INTERVAL;
  }
}

export async function runDaemon(options?: { hidden?: boolean }) {
  if (options?.hidden) {
    hideConsole();
  }

  try {
    ensureEnv();
    
    // Create lockfile
    writeFileSync(DAEMON_LOCK_PATH, process.pid.toString());
    
    const db = createDb();
    const repo = new JobRepository(db);

    // Cleanup stale running tasks
    repo.cleanupStaleJobs();

    const allJobs = repo.getAll();

    console.log("========================================");
    console.log("       PyRunner Daemon Started");
    console.log("========================================");
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`Monitoring ${allJobs.length} tasks:`);
    allJobs.forEach((j) => {
      console.log(
        ` - ${j.name.padEnd(15)} [${j.cron}] Next: ${new Date(j.next_run_time).toLocaleString()}`,
      );
    });
    console.log("----------------------------------------");

    // Poll using a safer recursive timeout with dynamic interval
    let tickTimer: Timer | null = null;
    const scheduleNextTick = async (isInitial: boolean = false) => {
      const msUntilNext = await tick(repo, isInitial);
      
      // Cap at 1 minute to stay responsive to DB changes/new jobs
      const sleepTime = Math.min(msUntilNext, 60000); 

      tickTimer = setTimeout(() => {
        scheduleNextTick(false);
      }, sleepTime);
    };

    await scheduleNextTick(true);

    // Graceful shutdown handler
    const cleanup = () => {
      logger.info("Daemon shutting down...");
      if (tickTimer) clearTimeout(tickTimer);
      try {
        unlinkSync(DAEMON_LOCK_PATH);
      } catch {}
      db.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

  } catch (error) {
    logger.error("Failed to start daemon:", error);
    process.exit(1);
  }
}
