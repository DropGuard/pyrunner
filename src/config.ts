import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export const PYRUNNER_DIR = join(homedir(), ".pyrunner");
export const LOGS_DIR = join(PYRUNNER_DIR, "logs");
export const DAEMON_LOCK_PATH = join(PYRUNNER_DIR, "daemon.lock");

export const HEARTBEAT_INTERVAL = 1000; // 1 second for better precision
export const DEFAULT_TIMEOUT = 600; // 600 seconds (10 minutes)

/**
 * Priority: 
 * 1. PYRUNNER_DB_PATH (Environment variable)
 * 2. :memory: (If running in test mode)
 * 3. Default path (~/.pyrunner/jobs.sqlite)
 */
export const DB_PATH = process.env.PYRUNNER_DB_PATH || 
  (process.env.NODE_ENV === "test" 
    ? ":memory:" 
    : join(PYRUNNER_DIR, "jobs.sqlite")
  );

export function ensureEnv() {
  mkdirSync(PYRUNNER_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}
