import { expect, test, describe, beforeEach, spyOn, afterEach } from "bun:test";
import { createDb, type Job, JobStatus, JobRepository } from "../src/db";
import { tick } from "../src/daemon";
import * as executor from "../src/executor";
import { type Database } from "bun:sqlite";

describe("Daemon Tick Logic", () => {
  let db: Database;
  let repo: JobRepository;
  
  beforeEach(() => {
    db = createDb(":memory:");
    repo = new JobRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("tick() should pick up and execute due jobs", async () => {
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("due_job", "test.py", ".", "* * * * *", now - 1000, JobStatus.Idle, now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {
      return Promise.resolve();
    });

    await tick(repo);

    expect(executeSpy).toHaveBeenCalled();
    const job = repo.getByName("due_job");
    expect(job?.status).toBe(JobStatus.Running);

    executeSpy.mockRestore();
  });

  test("tick() should NOT pick up jobs that are not yet due", async () => {
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)   
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("future_job", "test.py", ".", "* * * * *", now + 100000, JobStatus.Idle, now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {});

    await tick(repo);

    expect(executeSpy).not.toHaveBeenCalled();
    const job = repo.getByName("future_job");
    expect(job?.status).toBe(JobStatus.Idle);

    executeSpy.mockRestore();
  });

  test("tick() should NOT pick up jobs that are already running", async () => {
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, created_at)   
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("running_job", "test.py", ".", "* * * * *", now - 1000, JobStatus.Running, now);

    const executeSpy = spyOn(executor, "executeJob").mockImplementation(async () => {});

    await tick(repo);

    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
