import { Database } from "bun:sqlite";
import { DB_PATH } from "./config";

export enum JobStatus {
  Idle = "idle",
  Running = "running",
  Failed = "failed",
  MissingScript = "missing_script"
}

export interface Job {
  id?: number;
  name: string;
  script_path: string;
  working_dir: string;
  cron: string;
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
        next_run_time INTEGER,
        status TEXT DEFAULT 'idle',
        last_run_time INTEGER,
        last_exit_code INTEGER,
        pid INTEGER,
        created_at INTEGER
      )
    `);
  }
  return db;
}
