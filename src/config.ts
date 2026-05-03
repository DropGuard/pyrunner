import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export const PYRUNNER_DIR = join(homedir(), ".pyrunner");
export const LOGS_DIR = join(PYRUNNER_DIR, "logs");
export const DB_PATH = join(PYRUNNER_DIR, "jobs.sqlite");

export function ensureEnv() {
  mkdirSync(PYRUNNER_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}
