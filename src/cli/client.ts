import type { Config } from "@/shared/config";
import { ApiError, DaemonOfflineError } from "@/shared/errors";
import type {
  AddJobRequest,
  DaemonStatus,
  EditJobRequest,
  Job,
  LogContent,
  Response,
} from "@/shared/types";

export class DaemonClient {
  private baseURL: string;

  constructor(private config: Config) {
    this.baseURL = config.daemonUrl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      const res = await fetch(`${this.baseURL}${path}`, {
        method,
        unix: this.config.daemonIpcPath,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as Response<T>;
      if (!json.ok) throw new ApiError(json.error, json.code);
      return json.data;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Robust detection of connection failures (daemon offline)
      const isConnectionError =
        err instanceof TypeError ||
        (err instanceof Error &&
          (err.message.includes("fetch") ||
            err.message.includes("typo in the url or port") ||
            err.message.includes("connection refused") ||
            (err as any).code === "ECONNREFUSED" ||
            ((err as any).cause && (err as any).cause.code === "ECONNREFUSED")));

      if (isConnectionError) {
        throw new DaemonOfflineError();
      }
      throw err;
    }
  }

  health() {
    return this.request<{ status: string; version: string; uptime: number }>(
      "GET",
      "/api/v1/health",
    );
  }

  getDaemonStatus() {
    return this.request<DaemonStatus>("GET", "/api/v1/daemon/status");
  }

  listJobs() {
    return this.request<Job[]>("GET", "/api/v1/jobs");
  }

  getJob(name: string) {
    return this.request<Job>("GET", `/api/v1/jobs/${encodeURIComponent(name)}`);
  }

  addJob(data: AddJobRequest) {
    return this.request<{ name: string; next_run_time: number }>("POST", "/api/v1/jobs", data);
  }

  editJob(name: string, data: EditJobRequest) {
    return this.request<Job>("PATCH", `/api/v1/jobs/${encodeURIComponent(name)}`, data);
  }

  removeJob(name: string) {
    return this.request<{ deleted: string }>("DELETE", `/api/v1/jobs/${encodeURIComponent(name)}`);
  }

  runJob(name: string) {
    return this.request<{ triggered: string }>(
      "POST",
      `/api/v1/jobs/${encodeURIComponent(name)}/run`,
    );
  }

  killJob(name: string) {
    return this.request<{ killed: string }>(
      "POST",
      `/api/v1/jobs/${encodeURIComponent(name)}/kill`,
    );
  }

  killAllJobs() {
    return this.request<{ killed: number }>("POST", "/api/v1/jobs/kill-all");
  }

  getJobLogs(name: string, lines?: number) {
    const qs = lines ? `?lines=${lines}` : "";
    return this.request<LogContent>("GET", `/api/v1/jobs/${encodeURIComponent(name)}/logs${qs}`);
  }

  getAllLogs() {
    return this.request<Record<string, string>>("GET", "/api/v1/logs");
  }

  shutdown() {
    return this.request<{ shutting_down: boolean }>("POST", "/api/v1/daemon/shutdown");
  }
}
