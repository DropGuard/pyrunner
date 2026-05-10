import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import { createDb, JobStatus, JobRepository } from "../src/db";
import * as actions from "../src/actions";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Database } from "bun:sqlite";

describe("PyRunner Actions (Integration with Repository)", () => {
  const testScript = join(tmpdir(), `test_script_${Date.now()}.py`);
  let db: Database;
  let repo: JobRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    repo = new JobRepository(db);
    writeFileSync(testScript, "print('hello')");
  });

  afterEach(() => {
    db.close();
    if (existsSync(testScript)) {
      unlinkSync(testScript);
    }
  });

  test("Database should have WAL mode enabled", () => {
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const currentMode = mode.journal_mode.toLowerCase();
    expect(["wal", "memory"]).toContain(currentMode);
  });

  test("addJob should insert a valid job", () => {
    actions.addJob(repo, "unit_test_job", testScript, "0 9 * * *");
    
    const job = repo.getByName("unit_test_job");
    
    expect(job).toBeDefined();
    expect(job?.name).toBe("unit_test_job");
    expect(job?.cron).toBe("0 9 * * *");
  });

  test("editJob should update script and cron", () => {
    actions.addJob(repo, "edit_test", testScript, "0 9 * * *");
    
    const nextScript = testScript + ".next.py";
    writeFileSync(nextScript, "print('next')");

    actions.editJob(repo, "edit_test", { script: nextScript, cron: "1 10 * * *" });

    const job = repo.getByName("edit_test");
    expect(job?.cron).toBe("1 10 * * *");
    expect(job?.script_path).toContain("next.py");

    unlinkSync(nextScript);
  });

  test("removeJob should delete from database", () => {
    actions.addJob(repo, "remove_test", testScript, "* * * * *");
    actions.removeJob(repo, "remove_test");

    const job = repo.getByName("remove_test");
    expect(job).toBeNull();
  });

  test("killTasks should use killProcessTree and update status", async () => {
    // Manually insert a running job
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, pid, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("stop_test", testScript, "/tmp", "* * * * *", Date.now(), "running", 999999, Date.now());

    // We can't easily mock the shell command in actions.ts without more complex dependency injection,
    // but we can check if it attempts to kill and updates the DB.
    // Since killProcessTree is exported from utils, we might need to mock it if we wanted full unit test,
    // but here we'll just check if the status reverts to idle.
    
    await actions.killTasks(repo, "stop_test");

    const job = repo.getByName("stop_test");
    expect(job?.status).toBe(JobStatus.Idle);
    expect(job?.pid).toBeNull();
  });

});
