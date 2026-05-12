import { existsSync, unlinkSync } from "node:fs";
import { createDb } from "../db/index";
import { JobRepository } from "../db/job-repository";
import { DAEMON_IPC_PATH, ensureEnv } from "../shared/config";
import { logger } from "../utils/logger";
import { killProcessTree } from "../utils/process";
import { executeJob } from "./executor";
import { createRoutes } from "./routes";
import { scheduler } from "./scheduler";

export async function runDaemon(_options?: { hidden?: boolean }) {
  try {
    ensureEnv();

    // Clean up stale socket file
    if (existsSync(DAEMON_IPC_PATH)) {
      try {
        unlinkSync(DAEMON_IPC_PATH);
      } catch (e) {
        logger.warn(`Failed to clean up stale socket file: ${e}`);
      }
    }

    const db = createDb();

    const repo = new JobRepository(db);

    await repo.cleanupStaleJobs();

    // Initialize scheduler
    scheduler.initialize(repo, executeJob);

    // Schedule all existing jobs
    const allJobs = await repo.getAll();
    for (const job of allJobs) {
      scheduler.schedule(job);
    }

    // Create Hono app
    const app = createRoutes(repo, scheduler, executeJob);

    // Start IPC server (Unix Socket / Named Pipe)
    Bun.serve({
      fetch: app.fetch,
      unix: DAEMON_IPC_PATH,
    });

    const allJobsAfter = await repo.getAll();
    console.log("========================================");
    console.log("       PyRunner Daemon Started");
    console.log("========================================");
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`IPC:  ${DAEMON_IPC_PATH}`);
    console.log(`Monitoring ${allJobsAfter.length} tasks:`);
    for (const j of allJobsAfter) {
      const nextRun = scheduler.getNextRun(j.name);
      console.log(
        ` - ${j.name.padEnd(15)} [${j.cron}] Next: ${nextRun?.toLocaleString() ?? "N/A"}`,
      );
    }
    console.log("----------------------------------------");

    // Graceful shutdown
    const cleanup = async () => {
      logger.info("Daemon shutting down...");
      scheduler.stopAll();

      // Kill all running child processes
      const runningJobs = (await repo.getAll()).filter(
        (j) => j.status === "running" && j.pid !== null,
      );
      for (const job of runningJobs) {
        if (job.pid !== null) await killProcessTree(job.pid);
      }

      await db.destroy();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (error) {
    logger.error("Failed to start daemon:", error);
    process.exit(1);
  }
}
