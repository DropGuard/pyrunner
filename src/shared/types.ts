import type { ErrorCode } from "@/shared/errors";

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
  cron: string;
  next_run_time: number;
  status: JobStatus;
  last_run_time: number | null;
  last_exit_code: number | null;
  pid: number | null;
}

export type AddJobRequest = Pick<Job, "name" | "script_path" | "cron">;

export type EditJobRequest = Partial<Omit<AddJobRequest, "name">>;

export interface DaemonStatus {
  pid: number;
  port: number;
  jobCount: number;
  uptime: number;
}

export type LogContent = { content: string };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string; code: ErrorCode };
