import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export class Config {
  constructor(private env: Record<string, string | undefined> = process.env) {}

  get pyrunnerDir() {
    return this.env.PYRUNNER_DIR || join(homedir(), ".pyrunner");
  }

  get binDir() {
    return join(this.pyrunnerDir, "bin");
  }

  get logsDir() {
    return join(this.pyrunnerDir, "logs");
  }

  get daemonIpcPath() {
    return join(this.pyrunnerDir, "daemon.sock");
  }

  get defaultTimeout() {
    return 600; // 10 minutes
  }

  get dbPath() {
    return (
      this.env.PYRUNNER_DB_PATH ||
      (this.env.NODE_ENV === "test" ? ":memory:" : join(this.pyrunnerDir, "jobs.sqlite"))
    );
  }

  async ensureEnv() {
    await $`mkdir -p ${this.pyrunnerDir} ${this.binDir} ${this.logsDir}`;
  }

  get daemonUrl(): string {
    return "http://localhost";
  }
}
