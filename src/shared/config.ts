import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PYRUNNER_DIR = join(homedir(), ".pyrunner");
export const LOGS_DIR = join(PYRUNNER_DIR, "logs");
export const DAEMON_LOCK_PATH = join(PYRUNNER_DIR, "daemon.lock");
export const PORT_FILE_PATH = join(PYRUNNER_DIR, "daemon.port");

export const DEFAULT_PORT = 7890;
export const DEFAULT_TIMEOUT = 600; // 10 minutes

export const DB_PATH =
  process.env.PYRUNNER_DB_PATH ||
  (process.env.NODE_ENV === "test" ? ":memory:" : join(PYRUNNER_DIR, "jobs.sqlite"));

export function ensureEnv() {
  mkdirSync(PYRUNNER_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}

export function getPort(): number {
  if (process.env.PYRUNNER_PORT) {
    const p = parseInt(process.env.PYRUNNER_PORT, 10);
    if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
  }
  if (existsSync(PORT_FILE_PATH)) {
    const content = readFileSync(PORT_FILE_PATH, "utf-8").trim();
    const p = parseInt(content, 10);
    if (!Number.isNaN(p)) return p;
  }
  return DEFAULT_PORT;
}

export function getDaemonUrl(): string {
  return `http://127.0.0.1:${getPort()}`;
}
