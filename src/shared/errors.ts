export enum ErrorCode {
  JobNotFound = "JOB_NOT_FOUND",
  DaemonOffline = "DAEMON_OFFLINE",
  ValidationError = "VALIDATION_ERROR",
  AlreadyRunning = "ALREADY_RUNNING",
  ScriptNotFound = "SCRIPT_NOT_FOUND",
  NameConflict = "NAME_CONFLICT",
}
export class DaemonOfflineError extends Error {
  readonly code = ErrorCode.DaemonOffline;
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
