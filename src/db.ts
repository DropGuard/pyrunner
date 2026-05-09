import { Database } from "bun:sqlite";
import { DB_PATH, HEARTBEAT_THRESHOLD } from "./config";

export enum JobStatus {
  Idle = "idle",
  Running = "running",
  Failed = "failed",
  MissingScript = "missing_script",
}

export interface Job {
  id?: number;
  name: string;
  script_path: string;
  working_dir: string;
  cron: string;
  timeout?: number; // Timeout in seconds
  next_run_time: number;
  status: JobStatus;
  last_run_time?: number;
  last_exit_code?: number;
  pid?: number | null;
  created_at: number;
}

let db: Database;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        script_path TEXT,
        working_dir TEXT,
        cron TEXT,
        timeout INTEGER DEFAULT 600,
        next_run_time INTEGER,
        status TEXT DEFAULT 'idle',
        last_run_time INTEGER,
        last_exit_code INTEGER,
        pid INTEGER,
        created_at INTEGER
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS system_stats (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      )
    `);
    db.prepare(
      "INSERT OR IGNORE INTO system_stats (key, value, updated_at) VALUES (?, ?, ?)",
    ).run("daemon_heartbeat", "running", Date.now());
  }
  return db;
}

export function isDaemonActive(): boolean {
  const db = getDb();
  const heartbeat = db
    .prepare("SELECT updated_at FROM system_stats WHERE key = ?")
    .get("daemon_heartbeat") as { updated_at: number } | null;

  if (!heartbeat) return false;
  return Date.now() - heartbeat.updated_at < HEARTBEAT_THRESHOLD;
}
