import { expect, test, describe, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { getDb, JobStatus } from "../src/db";
import { DB_PATH } from "../src/config";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const HEARTBEAT_DB = resolve(process.cwd(), "test_heartbeat.sqlite");

describe("Heartbeat Mechanism", () => {
  beforeAll(() => {
    // Override DB_PATH for this specific test to avoid locking with other parallel tests
    process.env.PYRUNNER_DB_PATH = HEARTBEAT_DB;
    if (existsSync(HEARTBEAT_DB)) unlinkSync(HEARTBEAT_DB);
  });

  test("Database initialization should create system_stats table", () => {
    const db = getDb();
    const tableExists = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='system_stats'",
      )
      .get();
    expect(tableExists).toBeDefined();

    const heartbeat = db
      .prepare("SELECT * FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as any;
    expect(heartbeat).toBeDefined();
    expect(heartbeat.value).toBe("running");
  });

  test("Active status detection logic (threshold: 65s)", () => {
    const db = getDb();
    const now = Date.now();

    // 1. Test Active: Updated 10 seconds ago
    const tenSecsAgo = now - 10000;
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      tenSecsAgo,
      "daemon_heartbeat",
    );

    const rowActive = db
      .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as any;
    const isDaemonActive =
      rowActive && Date.now() - rowActive.updated_at < 65000;
    expect(isDaemonActive).toBe(true);

    // 2. Test Offline: Updated 70 seconds ago
    const seventySecsAgo = now - 70000;
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      seventySecsAgo,
      "daemon_heartbeat",
    );

    const rowOffline = db
      .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as any;
    const isDaemonOffline =
      !rowOffline || Date.now() - rowOffline.updated_at >= 65000;
    expect(isDaemonOffline).toBe(true);
  });
});
