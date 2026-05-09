import { ensureEnv, HEARTBEAT_INTERVAL } from "./config";
import { createDb, type Job, JobStatus } from "./db";
import { executeJob } from "./executor";
import { type Database } from "bun:sqlite";

export async function tick(db: Database, isInitial: boolean = false) {
  try {
    const now = Date.now();

    // Update heartbeat
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      now,
      "daemon_heartbeat",
    );

    const dueJobs = db
      .query(
        "SELECT * FROM jobs WHERE next_run_time <= $now AND status != $running",
      )
      .all({
        $now: now,
        $running: JobStatus.Running,
      }) as Job[];

    if (dueJobs.length > 0) {
      const type = isInitial ? "Catch-up" : "Scheduled";
      console.log(
        `[${new Date().toLocaleString()}] [${type}] Found ${dueJobs.length} due jobs. Attempting to start...`,
      );
      for (const job of dueJobs) {
        // Atomic status update
        const updated = db.prepare(
          "UPDATE jobs SET status = ? WHERE id = ? AND status != ? RETURNING *"
        ).get(JobStatus.Running, job.id!, JobStatus.Running) as Job | null;

        if (updated) {
          executeJob(db, updated, isInitial).catch((err) => {
            console.error(
              `[${new Date().toLocaleString()}] Unhandled error in job ${updated.name}:`,
              err,
            );
          });
        }
      }
    }
  } catch (error) {
    console.error(
      `[${new Date().toLocaleString()}] Error during daemon tick:`,
      error,
    );
  }
}

export async function runDaemon() {
  try {
    ensureEnv();
    const db = createDb();

    // Cleanup stale running tasks
    const runningJobs = db
      .query("SELECT * FROM jobs WHERE status = 'running'")
      .all() as Job[];
    if (runningJobs.length > 0) {
      console.log(
        `[${new Date().toLocaleString()}] Cleaning up ${runningJobs.length} stale running tasks...`,
      );
      db.prepare(
        "UPDATE jobs SET status = 'idle', pid = NULL WHERE status = 'running'",
      ).run();
    }

    const allJobs = db
      .query("SELECT name, cron, next_run_time FROM jobs")
      .all() as Pick<Job, "name" | "cron" | "next_run_time">[];

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

    // Initial tick for catch-up
    await tick(db, true);

    // Poll every 30 seconds using a safer recursive timeout
    let tickTimer: Timer | null = null;
    const scheduleNextTick = () => {
      tickTimer = setTimeout(async () => {
        await tick(db, false);
        scheduleNextTick();
      }, HEARTBEAT_INTERVAL);
    };

    // Graceful shutdown handler
    const cleanup = () => {
      if (tickTimer) clearTimeout(tickTimer);
      console.log("\n[Info] Shutting down daemon...");
      
      const runningCount = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as { count: number };
      if (runningCount.count > 0) {
        console.log(`[Info] Resetting ${runningCount.count} running tasks to idle...`);
        db.prepare("UPDATE jobs SET status = 'idle', pid = NULL WHERE status = 'running'").run();
      }
      
      db.close();
      console.log("[Info] Daemon stopped. Goodbye!");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    scheduleNextTick();
  } catch (error) {
    console.error("Failed to start daemon:", error);
    process.exit(1);
  }
}

// If this file is run directly
if (import.meta.path === Bun.main) {
  runDaemon();
}
