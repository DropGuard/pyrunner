import { executeJob } from "@/daemon/executor";
import { createRoutes } from "@/daemon/routes";
import { CronJobManager } from "@/daemon/scheduler";
import { createDb } from "@/db/index";
import { JobRepository } from "@/db/job-repository";
import type { Config } from "@/shared/config";
import { initLogger, logger } from "@/utils/logger";

export async function runDaemon(config: Config, _options?: { hidden?: boolean }) {
  await config.ensureEnv();
  initLogger(config.logsDir);

  const ipcPath = config.daemonIpcPath;

  // Socket cleanup: we don't care if it fails due to ENOENT
  try {
    await Bun.file(ipcPath).delete();
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code !== "ENOENT") {
      logger.warn(`Socket cleanup failed: ${(e as any).message}`);
    }
  }

  const db = createDb(config.dbPath);
  const repo = new JobRepository(db);
  const scheduler = new CronJobManager(config, repo, executeJob);

  try {
    await repo.cleanupStaleJobs();

    const allJobs = await repo.getAll();
    const now = Date.now();
    for (const job of allJobs) {
      if (job.next_run_time <= now && job.status !== "running") {
        logger.info(`Catching up missed job: ${job.name}`);
        // Fire asynchronously to not block startup
        repo.markAsRunning(job.id).then((updated) => {
          if (updated) {
            executeJob(repo, updated, config).catch((err) => {
              logger.error(`Unhandled error catching up job ${updated.name}:`, err);
            });
          }
        });
      }
      scheduler.schedule(job);
    }

    // Proper shutdown signal handling
    const { promise: shutdownPromise, resolve: triggerShutdown } = Promise.withResolvers<void>();

    const app = createRoutes(repo, scheduler, executeJob, triggerShutdown, config);

    const server = Bun.serve({
      fetch: app.fetch,
      unix: ipcPath,
    });

    logger.info("========================================");
    logger.info("       PyRunner Daemon Started");
    logger.info("========================================");
    logger.info(`IPC:  ${ipcPath}`);
    logger.info(`Monitoring ${allJobs.length} tasks`);
    logger.info("----------------------------------------");

    const cleanup = async (signal: string) => {
      logger.info(`Daemon shutting down (signal: ${signal})...`);
      scheduler.stopAll();
      server.stop();
      await db.destroy();
      process.exit(0);
    };

    process.on("SIGINT", () => triggerShutdown());
    process.on("SIGTERM", () => triggerShutdown());

    // Wait for shutdown trigger (from API or signals)
    await shutdownPromise;
    setTimeout(() => {
      cleanup("TRIGGER").catch(() => {});
    }, 100);
  } catch (error) {
    logger.error("Daemon startup error:", error);
    process.exit(1);
  }
}
