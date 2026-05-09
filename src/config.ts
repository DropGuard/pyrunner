import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export const PYRUNNER_DIR = join(homedir(), ".pyrunner");
export const LOGS_DIR = join(PYRUNNER_DIR, "logs");

const isTest = process.env.NODE_ENV === "test";
export const DB_PATH = isTest
  ? join(process.cwd(), "test_jobs.sqlite")
  : process.env.PYRUNNER_DB_PATH || join(PYRUNNER_DIR, "jobs.sqlite");

export function ensureEnv() {
  mkdirSync(PYRUNNER_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}
