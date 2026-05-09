import { Database } from "bun:sqlite";
import { DB_PATH, DAEMON_LOCK_PATH } from "./config";
import { existsSync, readFileSync } from "node:fs";

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
  timeout?: number;
  next_run_time: number;
  status: JobStatus;
  last_run_time?: number;
  last_exit_code?: number;
  pid?: number | null;
  created_at: number;
}

export class JobRepository {
  constructor(private db: Database) {}

  getAll(): Job[] {
    return this.db.query("SELECT * FROM jobs").all() as Job[];
  }

  getByName(name: string): Job | null {
    return this.db.prepare("SELECT * FROM jobs WHERE name = ?").get(name) as Job | null;
  }

  getDueJobs(now: number): Job[] {
    return this.db
      .query("SELECT * FROM jobs WHERE next_run_time <= $now AND status != $running")
      .all({ $now: now, $running: JobStatus.Running }) as Job[];
  }

  markAsRunning(id: number): Job | null {
    return this.db.prepare(`
      UPDATE jobs 
      SET status = ?, last_run_time = ? 
      WHERE id = ? AND status != ? 
      RETURNING *
    `).get(JobStatus.Running, Date.now(), id, JobStatus.Running) as Job | null;
  }

  updatePid(id: number, pid: number | null) {
    this.db.prepare("UPDATE jobs SET pid = ? WHERE id = ?").run(pid, id);
  }

  finalize(id: number, exitCode: number, nextRun: number, status: JobStatus = JobStatus.Idle) {
    this.db.prepare(`
      UPDATE jobs 
      SET status = ?, last_exit_code = ?, next_run_time = ?, pid = NULL 
      WHERE id = ?
    `).run(status, exitCode, nextRun, id);
  }

  add(job: Omit<Job, "id" | "status" | "created_at">) {
    this.db.prepare(`
      INSERT INTO jobs (name, script_path, working_dir, cron, timeout, next_run_time, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.name, 
      job.script_path, 
      job.working_dir, 
      job.cron, 
      job.timeout ?? 600, 
      job.next_run_time, 
      JobStatus.Idle, 
      Date.now()
    );
  }

  update(name: string, data: Partial<Pick<Job, "script_path" | "working_dir" | "cron" | "timeout" | "next_run_time">>) {
    const keys = Object.keys(data);
    if (keys.length === 0) return;
    const sets = keys.map(k => `${k} = ?`).join(", ");
    const values = Object.values(data);
    this.db.prepare(`UPDATE jobs SET ${sets} WHERE name = ?`).run(...values, name);
  }

  delete(name: string): boolean {
    const res = this.db.prepare("DELETE FROM jobs WHERE name = ?").run(name);
    return res.changes > 0;
  }

  cleanupStaleJobs() {
    this.db.prepare("UPDATE jobs SET status = ?, pid = NULL WHERE status = ?")
      .run(JobStatus.Idle, JobStatus.Running);
  }
}

export function createDb(path: string = DB_PATH): Database {
  const d = new Database(path);
  d.run("PRAGMA journal_mode = WAL");
  d.run("PRAGMA synchronous = NORMAL");

  // Clean, final schema
  d.run(`
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

  d.run("CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs (next_run_time)");
  d.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)");

  return d;
}

export function isDaemonActive(): boolean {
  if (!existsSync(DAEMON_LOCK_PATH)) return false;
  try {
    const pid = parseInt(readFileSync(DAEMON_LOCK_PATH, "utf-8").trim());
    if (isNaN(pid)) return false;
    process.kill(pid, 0); 
    return pid !== process.pid;
  } catch {
    return false;
  }
}
