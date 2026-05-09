import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createDb } from "../src/db";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Database Migration Logic", () => {
  // Use a unique filename for each test run to avoid EBUSY on Windows
  const getDbPath = () => join(tmpdir(), `migration_test_${Math.random().toString(36).slice(2)}.sqlite`);
  let currentDbPath: string;

  afterEach(() => {
    // No-op, file cleanup is hard on Windows if tests fail mid-way
  });

  test("Upgrade from Very Old Legacy to Version 1", () => {
    currentDbPath = getDbPath();
    // 1. Manually create a "barebones" database
    const oldDb = new Database(currentDbPath);
    oldDb.run(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        status TEXT DEFAULT 'idle'
      )
    `);
    oldDb.prepare("INSERT INTO jobs (name) VALUES (?)").run("very_old_job");
    oldDb.close(); // Crucial: close before createDb opens it again

    // 2. Use our managed createDb to open it
    const db = createDb(currentDbPath);

    // 3. Verify version upgrade
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(1);

    // 4. Verify columns were added
    const tableInfo = db.prepare("PRAGMA table_info(jobs)").all() as any[];
    const columns = tableInfo.map(c => c.name);
    expect(columns).toContain("timeout");
    expect(columns).toContain("next_run_time");

    // 5. Verify data fix
    const job = db.prepare("SELECT * FROM jobs WHERE name = ?").get("very_old_job") as any;
    expect(job.timeout).toBe(600);

    db.close();
    if (existsSync(currentDbPath)) unlinkSync(currentDbPath);
  });

  test("New database should start at target version", () => {
    const db = createDb(":memory:");
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(1);
    db.close();
  });
});
