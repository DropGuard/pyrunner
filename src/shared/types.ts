export enum JobStatus {
  Idle = "idle",
  Running = "running",
  Failed = "failed",
  MissingScript = "missing_script",
}

export interface Job {
  id: number;
  name: string;
  script_path: string;
  working_dir: string;
  cron: string;
  timeout: number;
  next_run_time: number;
  status: JobStatus;
  last_run_time: number | null;
  last_exit_code: number | null;
  pid: number | null;
  created_at: number;
}

export interface NewJob {
  name: string;
  script_path: string;
  working_dir: string;
  cron: string;
  timeout?: number;
  next_run_time: number;
}

export interface AddJobRequest {
  name: string;
  script_path: string;
  cron: string;
  timeout?: number;
}

export interface EditJobRequest {
  script?: string;
  cron?: string;
  timeout?: number;
}

export interface DaemonStatus {
  pid: number;
  port: number;
  jobCount: number;
  uptime: number;
}

export interface LogContent {
  content: string;
}

export type ErrorCode =
  | "JOB_NOT_FOUND"
  | "DAEMON_OFFLINE"
  | "VALIDATION_ERROR"
  | "ALREADY_RUNNING"
  | "SCRIPT_NOT_FOUND"
  | "NAME_CONFLICT";

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; code: ErrorCode };
