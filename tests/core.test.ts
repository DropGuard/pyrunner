import { expect, test, describe, beforeAll } from "bun:test";
import { getDb } from "../src/db";
import { calculateNextRun } from "../src/executor";
import { ensureEnv, PYRUNNER_DIR } from "../src/config";
import { Database } from "bun:sqlite";


describe("PyRunner Core", () => {
  beforeAll(() => {
    ensureEnv();
  });

  test("Config paths are correct", () => {
    expect(PYRUNNER_DIR).toContain(".pyrunner");
  });

  test("Database initialization", () => {
    const db = getDb();
    expect(db).toBeInstanceOf(Database);

    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all();
    expect(tables.length).toBe(1);
  });

  test("Cron parsing and next run calculation", () => {
    const cron = "0 9 * * *"; // Every day at 9 AM
    const nextRun = calculateNextRun(cron);
    const date = new Date(nextRun);

    expect(nextRun).toBeGreaterThan(Date.now());
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  test("Job CRUD operations", () => {
    const db = getDb();
    const jobName = "test_unit_job";

    // Create
    db.prepare("INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(jobName, "/tmp/test.py", "/tmp", "* * * * *", Date.now(), Date.now());

    const job = db.query("SELECT * FROM jobs WHERE name = ?").get(jobName) as any;
    expect(job).toBeDefined();
    expect(job.name).toBe(jobName);

    // Update status
    db.prepare("UPDATE jobs SET status = 'running' WHERE name = ?").run(jobName);
    const updatedJob = db.query("SELECT * FROM jobs WHERE name = ?").get(jobName) as any;
    expect(updatedJob.status).toBe("running");

    // Delete
    db.prepare("DELETE FROM jobs WHERE name = ?").run(jobName);
    const deletedJob = db.query("SELECT * FROM jobs WHERE name = ?").get(jobName);
    expect(deletedJob).toBeNull();
  });
});
