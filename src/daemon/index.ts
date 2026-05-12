import { unlinkSync, writeFileSync } from "node:fs";
import { createDb } from "../db/index";
import { JobRepository } from "../db/job-repository";
import { DAEMON_LOCK_PATH, DEFAULT_PORT, ensureEnv, PORT_FILE_PATH } from "../shared/config";
import { logger } from "../utils/logger";
import { hideConsole, killProcessTree } from "../utils/process";
import { executeJob } from "./executor";
import { createRoutes } from "./routes";
import { scheduler } from "./scheduler";

export async function runDaemon(options?: { hidden?: boolean }) {
  if (options?.hidden) hideConsole();

  try {
    ensureEnv();

    const db = createDb();
    const repo = new JobRepository(db);

    await repo.cleanupStaleJobs();

    // Write lockfile for backward compatibility
    writeFileSync(DAEMON_LOCK_PATH, process.pid.toString());

    // Determine and write port
    const port = parseInt(process.env.PYRUNNER_PORT || "", 10) || DEFAULT_PORT;
    writeFileSync(PORT_FILE_PATH, port.toString());

    // Initialize scheduler
    scheduler.initialize(repo, executeJob);

    // Schedule all existing jobs
    const allJobs = await repo.getAll();
    for (const job of allJobs) {
      scheduler.schedule(job);
    }

    // Create Hono app
    const app = createRoutes(repo, scheduler, executeJob);

    // Start HTTP server
    Bun.serve({
      fetch: app.fetch,
      port,
      hostname: "127.0.0.1",
    });

    const allJobsAfter = await repo.getAll();
    console.log("========================================");
    console.log("       PyRunner Daemon Started");
    console.log("========================================");
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`Port: ${port}`);
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

      try {
        unlinkSync(PORT_FILE_PATH);
      } catch {}
      try {
        unlinkSync(DAEMON_LOCK_PATH);
      } catch {}
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
