import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { getDb, isDaemonActive } from "../src/db";
import { tick } from "../src/daemon";
import { HEARTBEAT_THRESHOLD } from "../src/config";

describe("Heartbeat Mechanism (Scientific)", () => {
  const db = getDb();

  test("tick() should update daemon_heartbeat", async () => {
    // 1. Get current heartbeat
    const before = db
      .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as any;
    
    // Wait a bit to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 10));

    // 2. Run tick
    await tick();

    // 3. Check if updated_at increased
    const after = db
      .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
      .get("daemon_heartbeat") as any;
    
    expect(after.updated_at).toBeGreaterThan(before?.updated_at || 0);
  });

  test("isDaemonActive() should follow HEARTBEAT_THRESHOLD", () => {
    const now = Date.now();

    // Case 1: Just updated
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      now - 1000,
      "daemon_heartbeat"
    );
    expect(isDaemonActive()).toBe(true);

    // Case 2: Exactly at threshold (should be false or true depending on < or <=, we used <)
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      now - HEARTBEAT_THRESHOLD,
      "daemon_heartbeat"
    );
    expect(isDaemonActive()).toBe(false);

    // Case 3: Way past threshold
    db.prepare("UPDATE system_stats SET updated_at = ? WHERE key = ?").run(
      now - (HEARTBEAT_THRESHOLD + 10000),
      "daemon_heartbeat"
    );
    expect(isDaemonActive()).toBe(false);
  });

  test("isDaemonActive() should return false if no heartbeat record exists", () => {
    db.prepare("DELETE FROM system_stats WHERE key = ?").run("daemon_heartbeat");
    expect(isDaemonActive()).toBe(false);

    // Restore for other tests if needed
    db.prepare("INSERT INTO system_stats (key, value, updated_at) VALUES (?, ?, ?)")
      .run("daemon_heartbeat", "running", Date.now());
  });
});
