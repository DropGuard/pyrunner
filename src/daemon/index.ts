import { unlink } from "node:fs/promises";
import { createDb } from "../db/index";
import { JobRepository } from "../db/job-repository";
import { DAEMON_IPC_PATH, ensureEnv } from "../shared/config";
import { logger } from "../utils/logger";
import { killProcessTree } from "../utils/process";
import { executeJob } from "./executor";
import { createRoutes } from "./routes";
import { scheduler } from "./scheduler";

export async function runDaemon(_options?: { hidden?: boolean }) {
  await ensureEnv();

  // Socket cleanup: we don't care if it fails due to ENOENT
  await unlink(DAEMON_IPC_PATH).catch((e) => {
    if (e.code !== "ENOENT") logger.warn(`Socket cleanup failed: ${e.message}`);
  });

  const db = createDb();
  const repo = new JobRepository(db);

  try {
    await repo.cleanupStaleJobs();
    scheduler.initialize(repo, executeJob);

    const allJobs = await repo.getAll();
    allJobs.forEach((job) => scheduler.schedule(job));

    const app = createRoutes(repo, scheduler, executeJob);

    Bun.serve({
      fetch: app.fetch,
      unix: DAEMON_IPC_PATH,
    });

    console.log("========================================");
    console.log("       PyRunner Daemon Started");
    console.log("========================================");
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`IPC:  ${DAEMON_IPC_PATH}`);
    console.log(`Monitoring ${allJobs.length} tasks`);
    console.log("----------------------------------------");

    const cleanup = async () => {
      logger.info("Daemon shutting down...");
      scheduler.stopAll();

      const runningJobs = (await repo.getAll()).filter(
        (j) => j.status === "running" && j.pid !== null,
      );
      
      await Promise.all(runningJobs.map(j => killProcessTree(j.pid!, true)));
      await db.destroy();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

  } catch (error) {
    logger.error("Daemon startup error:", error);
    process.exit(1);
  }
}
