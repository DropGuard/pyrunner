import { expect, test, describe, beforeEach, spyOn, afterEach } from "bun:test";
import { createDb } from "../src/db";
import { tick } from "../src/daemon";
import * as executor from "../src/executor";
import { type Database } from "bun:sqlite";

describe("Daemon Tick & Job Triggering (with DI)", () => {
  let db: Database;
  
  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("tick() should pick up and execute due jobs", async () => {
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("due_job", "test.py", ".", "* * * * *", now - 1000, "idle", now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {
      return Promise.resolve();
    });

    await tick(db);

    expect(executeSpy).toHaveBeenCalled();
    const job = db.query("SELECT * FROM jobs WHERE name = 'due_job'").get() as Job;
    expect(job.status).toBe("running");

    executeSpy.mockRestore();
    });

    test("tick() should NOT pick up jobs that are not yet due", async () => {
    const now = Date.now();

    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)   
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("future_job", "test.py", ".", "* * * * *", now + 100000, "idle", now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {});

    await tick(db);

    expect(executeSpy).not.toHaveBeenCalled();
    const job = db.query("SELECT * FROM jobs WHERE name = 'future_job'").get() as Job;
    expect(job.status).toBe("idle");

    executeSpy.mockRestore();
    });
  test("tick() should NOT pick up jobs that are already running", async () => {
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("running_job", "test.py", ".", "* * * * *", now - 1000, "running", now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {});

    await tick(db);

    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
