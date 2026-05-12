import { mkdir } from "node:fs/promises";
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

export async function ensureEnv() {
  await mkdir(PYRUNNER_DIR, { recursive: true });
  await mkdir(BIN_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
}

export function getDaemonUrl(): string {
  return "http://localhost";
}
