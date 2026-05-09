import { Database } from "bun:sqlite";
import { DB_PATH } from "./config";
import { execSync } from "node:child_process";

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

/**
 * Creates and initializes a new database connection.
 * @param path The path to the database file or ":memory:".
 */
export function createDb(path: string = DB_PATH): Database {
  const d = new Database(path);
  
  // Performance and concurrency optimizations
  d.run("PRAGMA journal_mode = WAL");
  d.run("PRAGMA synchronous = NORMAL");

  // Initial schema (basic structure)
  d.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      created_at INTEGER
    )
  `);

  // Migration logic (Must run BEFORE creating indexes on new columns)
  const currentVersion = d.prepare("PRAGMA user_version").get() as { user_version: number };
  const targetVersion = 1;

  if (currentVersion.user_version < targetVersion) {
    const tableInfo = d.prepare("PRAGMA table_info(jobs)").all() as any[];
    const columns = tableInfo.map(c => c.name);

    const requiredColumns = [
      { name: "script_path", type: "TEXT" },
      { name: "working_dir", type: "TEXT" },
      { name: "cron", type: "TEXT" },
      { name: "timeout", type: "INTEGER DEFAULT 600" },
      { name: "next_run_time", type: "INTEGER" },
      { name: "status", type: "TEXT DEFAULT 'idle'" },
      { name: "last_run_time", type: "INTEGER" },
      { name: "last_exit_code", type: "INTEGER" },
      { name: "pid", type: "INTEGER" },
    ];

    for (const col of requiredColumns) {
      if (!columns.includes(col.name)) {
        d.run(`ALTER TABLE jobs ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // Data fix: Ensure all existing jobs have a timeout
    d.run("UPDATE jobs SET timeout = 600 WHERE timeout IS NULL");
    
    d.run(`PRAGMA user_version = ${targetVersion}`);
  }

  // Now safe to create indexes and tables that depend on migrated schema
  d.run("CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs (next_run_time)");
  d.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)");

  d.run(`
    CREATE TABLE IF NOT EXISTS system_stats (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    )
  `);

  return d;
}

/**
 * Checks if the daemon process is currently running using system-level process scanning.
 * This is a "zero-write" check that doesn't rely on database heartbeats.
 */
export function isDaemonActive(db?: Database): boolean {
  try {
    if (process.platform === "win32") {
      // Robust Windows check: Use WMIC to find any process whose command line contains both 'pyrunner' and 'daemon'.
      // This avoids issues with different executable names (bun.exe, node.exe, pyrunner.exe, etc.)
      const cmd = 'wmic process where "commandline like \'%pyrunner%daemon%\'" get processid /format:list';
      const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" });
      
      // Filter out our own process if we are running 'pyrunner daemon' in the foreground
      const pids = out.split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("ProcessId="))
        .map(line => line.split("=")[1])
        .filter((pid): pid is string => !!pid);

      return pids.some(pid => parseInt(pid) !== process.pid);
    } else {
      // Unix check: pgrep -f matches the full command line
      const out = execSync('pgrep -f "pyrunner.*daemon"', { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" });
      const pids = out.trim().split("\n");
      return pids.some(pid => parseInt(pid) !== process.pid);
    }
  } catch {
    // If command fails or no match found, assume offline
    return false;
  }
}
