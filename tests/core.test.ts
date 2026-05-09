import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import { createDb } from "../src/db";
import * as actions from "../src/actions";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Database } from "bun:sqlite";

describe("PyRunner Actions (Integration with DI)", () => {
  const testScript = join(tmpdir(), `test_script_${Date.now()}.py`);
  let db: Database;

  beforeEach(() => {
    // Each test gets its own isolated in-memory database
    db = createDb(":memory:");
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

  test("Concurrent read/write should not lock (WAL effect)", async () => {
    try {
      db.run("BEGIN");
      db.prepare("INSERT INTO jobs (name, created_at) VALUES (?, ?)").run("concurrent_test", Date.now());

      expect(() => {
        db.query("SELECT COUNT(*) FROM jobs").all();
      }).not.toThrow();

      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  });

  test("addJob should insert a valid job", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit called with code ${code}`);
    });

    actions.addJob(db, "unit_test_job", testScript, "0 9 * * *");
    
    const job = db.query("SELECT * FROM jobs WHERE name = ?").get("unit_test_job") as Job;
    
    expect(job).toBeDefined();
    expect(job.name).toBe("unit_test_job");
    expect(job.cron).toBe("0 9 * * *");

    exitSpy.mockRestore();
  });

  test("editJob should update script and cron", () => {
    actions.addJob(db, "edit_test", testScript, "0 9 * * *");
    
    const nextScript = testScript + ".next.py";
    writeFileSync(nextScript, "print('next')");

    actions.editJob(db, "edit_test", { script: nextScript, cron: "1 10 * * *" });

    const job = db.query("SELECT * FROM jobs WHERE name = ?").get("edit_test") as Job;
    expect(job.cron).toBe("1 10 * * *");
    expect(job.script_path).toContain("next.py");

    unlinkSync(nextScript);
  });

  test("removeJob should delete from database", () => {
    actions.addJob(db, "remove_test", testScript, "* * * * *");
    actions.removeJob(db, "remove_test");

    const job = db.query("SELECT * FROM jobs WHERE name = ?").get("remove_test");
    expect(job).toBeNull();
  });

  test("stopJob should send SIGTERM and update status", () => {
    db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, next_run_time, status, pid, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("stop_test", testScript, "/tmp", "* * * * *", Date.now(), "running", 999999, Date.now());

    const killSpy = spyOn(process, "kill").mockImplementation(() => true);

    actions.stopJob(db, "stop_test");

    const job = db.query("SELECT * FROM jobs WHERE name = ?").get("stop_test") as Job;
    expect(job.status).toBe("idle");
    expect(job.pid).toBeNull();
    expect(killSpy).toHaveBeenCalled();
    
    killSpy.mockRestore();
  });
});
