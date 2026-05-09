import { ensureEnv, HEARTBEAT_INTERVAL } from "./config";
import { getDb, type Job, JobStatus } from "./db";
import { executeJob } from "./executor";

export async function tick(isInitial: boolean = false) {
  try {
    const db = getDb();
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
        // Atomic status update to prevent race conditions between multiple daemon instances
        // We only pick up the job if it's still not running
        const updated = db.prepare(
          "UPDATE jobs SET status = $running WHERE id = $id AND status != $running RETURNING *"
        ).get({
          $id: job.id,
          $running: JobStatus.Running
        }) as Job | null;

        if (updated) {
          // We don't await executeJob here to allow parallel execution,
          // but executeJob itself should handle its own errors.
          executeJob(updated, isInitial).catch((err) => {
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
    const db = getDb();

    // Cleanup: Reset any jobs that were left in 'running' state from a previous crash/shutdown
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
      .all() as any[];

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
    await tick(true);

    // Poll every 30 seconds
    setInterval(() => tick(false), HEARTBEAT_INTERVAL);
  } catch (error) {
    console.error("Failed to start daemon:", error);
    process.exit(1);
  }
}

// If this file is run directly
if (import.meta.path === Bun.main) {
  runDaemon();
}
