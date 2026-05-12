import type { ErrorCode } from "./types";

export class DaemonOfflineError extends Error {
  readonly code = "DAEMON_OFFLINE" as const;
  constructor() {
    super("Scheduler daemon is not running");
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode) {
    super(message);
    this.code = code;
  }
}
