import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PYRUNNER_DIR = join(homedir(), ".pyrunner");
export const BIN_DIR = join(PYRUNNER_DIR, "bin");
export const LOGS_DIR = join(PYRUNNER_DIR, "logs");

export const DAEMON_IPC_PATH = join(PYRUNNER_DIR, "daemon.sock");

export const DEFAULT_TIMEOUT = 600; // 10 minutes

export const DB_PATH =
  process.env.PYRUNNER_DB_PATH ||
  (process.env.NODE_ENV === "test" ? ":memory:" : join(PYRUNNER_DIR, "jobs.sqlite"));

export function ensureEnv() {
  mkdirSync(PYRUNNER_DIR, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}

export function getDaemonUrl(): string {
  return "http://localhost";
}
