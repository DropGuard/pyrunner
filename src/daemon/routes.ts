import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import type { JobRepository } from "../db/job-repository";
import { LOGS_DIR } from "../shared/config";
import { JobStatus } from "../shared/types";
import { calculateNextRun } from "../utils/cron";
import { killProcessTree } from "../utils/process";
import type { executeJob } from "./executor";
import type { scheduler } from "./scheduler";

export function createRoutes(
  repo: JobRepository,
  schedulerInstance: typeof scheduler,
  executeJobFn: typeof executeJob,
): Hono {
  const app = new Hono();

  const ok = <T>(data: T) => ({ ok: true as const, data });
  const err = (error: string, code: string) => ({ ok: false as const, error, code });

  // Health
  app.get("/api/v1/health", (c) =>
    c.json(ok({ status: "ok", version: "0.2.0", uptime: process.uptime() })),
  );

  // Daemon status
  app.get("/api/v1/daemon/status", async (c) => {
    const jobs = await repo.getAll();
    return c.json(
      ok({
        pid: process.pid,
        port: parseInt(process.env.PYRUNNER_PORT || "7890", 10),
        jobCount: jobs.length,
        uptime: process.uptime(),
      }),
    );
  });

  // List all jobs
  app.get("/api/v1/jobs", async (c) => {
    const jobs = await repo.getAll();
    return c.json(ok(jobs));
  });

  // Get single job
  app.get("/api/v1/jobs/:name", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);
    return c.json(ok(job));
  });

  // Add job
  app.post("/api/v1/jobs", async (c) => {
    const body = await c.req.json();
    const { name, script_path, cron, timeout } = body;

    if (!name || !script_path || !cron) {
      return c.json(
        err("Missing required fields: name, script_path, cron", "VALIDATION_ERROR"),
        400,
      );
    }

    const absolutePath = resolve(process.cwd(), script_path);

    try {
      calculateNextRun(cron);
    } catch {
      return c.json(err(`Invalid cron expression: ${cron}`, "VALIDATION_ERROR"), 400);
    }

    const nextRun = calculateNextRun(cron);
    try {
      await repo.add({
        name,
        script_path: absolutePath,
        working_dir: dirname(absolutePath),
        cron,
        timeout: timeout ?? 600,
        next_run_time: nextRun,
      });

      const job = await repo.getByName(name);
      if (job) schedulerInstance.schedule(job);

      return c.json(ok({ name, next_run_time: nextRun }), 201);
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return c.json(err(`Task '${name}' already exists`, "NAME_CONFLICT"), 409);
      }
      throw e;
    }
  });

  // Edit job
  app.patch("/api/v1/jobs/:name", async (c) => {
    const name = c.req.param("name");
    const existing = await repo.getByName(name);
    if (!existing) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);

    const body = await c.req.json();
    const updates: Record<string, unknown> = {};

    if (body.script) {
      const absPath = resolve(process.cwd(), body.script);
      updates.script_path = absPath;
      updates.working_dir = dirname(absPath);
    }
    if (body.cron) {
      try {
        calculateNextRun(body.cron);
      } catch {
        return c.json(err(`Invalid cron expression: ${body.cron}`, "VALIDATION_ERROR"), 400);
      }
      updates.cron = body.cron;
      updates.next_run_time = calculateNextRun(body.cron);
    }
    if (body.timeout !== undefined) {
      updates.timeout = body.timeout;
    }

    if (Object.keys(updates).length === 0) {
      return c.json(err("No changes specified", "VALIDATION_ERROR"), 400);
    }

    await repo.update(name, updates);
    const updated = await repo.getByName(name);
    if (updated) schedulerInstance.schedule(updated);

    return c.json(ok(updated));
  });

  // Remove job
  app.delete("/api/v1/jobs/:name", async (c) => {
    const name = c.req.param("name");
    schedulerInstance.unschedule(name);
    const deleted = await repo.delete(name);
    if (!deleted) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);
    return c.json(ok({ deleted: name }));
  });

  // Run job
  app.post("/api/v1/jobs/:name/run", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);
    if (job.status === JobStatus.Running) {
      return c.json(err(`Task '${name}' is already running`, "ALREADY_RUNNING"), 409);
    }

    const updated = await repo.markAsRunning(job.id);
    if (!updated) {
      return c.json(err(`Task '${name}' is already running`, "ALREADY_RUNNING"), 409);
    }

    // Fire and forget
    executeJobFn(repo, updated, { truncateLog: true }).catch(() => {});

    return c.json(ok({ triggered: name }));
  });

  // Kill job
  app.post("/api/v1/jobs/:name/kill", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);
    if (job.status !== JobStatus.Running || !job.pid) {
      return c.json(err(`Task '${name}' is not running`, "VALIDATION_ERROR"), 400);
    }

    await killProcessTree(job.pid);
    await repo.finalize(job.id, -1, job.next_run_time, JobStatus.Idle);
    return c.json(ok({ killed: name }));
  });

  // Kill all
  app.post("/api/v1/jobs/kill-all", async (c) => {
    const jobs = (await repo.getAll()).filter(
      (j) => j.status === JobStatus.Running && j.pid !== null,
    );
    for (const job of jobs) {
      if (job.pid !== null) await killProcessTree(job.pid);
      await repo.finalize(job.id, -1, job.next_run_time, JobStatus.Idle);
    }
    return c.json(ok({ killed: jobs.length }));
  });

  // Get logs for a job
  app.get("/api/v1/jobs/:name/logs", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, "JOB_NOT_FOUND"), 404);

    const lines = parseInt(c.req.query("lines") || "0", 10) || 0;
    const logPath = join(LOGS_DIR, `${name}.log`);

    if (!existsSync(logPath)) {
      return c.json(ok({ content: "" }));
    }

    try {
      const content = readFileSync(logPath, "utf-8");
      if (lines > 0) {
        const allLines = content.split("\n");
        return c.json(ok({ content: allLines.slice(-lines).join("\n") }));
      }
      return c.json(ok({ content }));
    } catch {
      return c.json(ok({ content: "" }));
    }
  });

  // Get all logs summary
  app.get("/api/v1/logs", async (c) => {
    const jobs = await repo.getAll();
    const logs: Record<string, string> = {};
    for (const job of jobs) {
      const logPath = join(LOGS_DIR, `${job.name}.log`);
      if (existsSync(logPath)) {
        try {
          const content = readFileSync(logPath, "utf-8");
          const lines = content.split("\n");
          logs[job.name] = lines.slice(-10).join("\n");
        } catch {
          logs[job.name] = "";
        }
      }
    }
    return c.json(ok(logs));
  });

  // Shutdown
  app.post("/api/v1/daemon/shutdown", (c) => {
    setTimeout(() => process.emit("SIGTERM"), 100);
    return c.json(ok({ shutting_down: true }));
  });

  return app;
}
