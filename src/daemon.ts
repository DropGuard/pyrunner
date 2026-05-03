import { ensureEnv } from "./config";
import { getDb, type Job, JobStatus } from "./db";
import { executeJob } from "./executor";

async function tick(isInitial: boolean = false) {
  const db = getDb();
  const now = Date.now();

  const dueJobs = db.query("SELECT * FROM jobs WHERE next_run_time <= $now AND status != $running").all({ 
    $now: now,
    $running: JobStatus.Running 
  }) as Job[];

  if (dueJobs.length > 0) {
    const type = isInitial ? "Catch-up" : "Scheduled";
    console.log(`[${new Date().toLocaleString()}] [${type}] Found ${dueJobs.length} due jobs.`);
    for (const job of dueJobs) {
      executeJob(job, isInitial);
    }
  }
}

export async function runDaemon() {
  ensureEnv();
  const db = getDb();
  const allJobs = db.query("SELECT name, cron, next_run_time FROM jobs").all() as any[];

  console.log("========================================");
  console.log("       PyRunner Daemon Started");
  console.log("========================================");
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Monitoring ${allJobs.length} tasks:`);
  allJobs.forEach(j => {
    console.log(` - ${j.name.padEnd(15)} [${j.cron}] Next: ${new Date(j.next_run_time).toLocaleString()}`);
  });
  console.log("----------------------------------------");
  
  // Initial tick for catch-up
  await tick(true);

  // Poll every 30 seconds
  setInterval(() => tick(false), 30 * 1000);
}

// If this file is run directly
if (import.meta.path === Bun.main) {
  ensureEnv();
  runDaemon();
}
