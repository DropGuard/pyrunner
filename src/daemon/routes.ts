import { join, resolve } from "node:path";
import { Hono } from "hono";
import type { executeJob } from "@/daemon/executor";
import type { CronJobManager } from "@/daemon/scheduler";
import type { JobRepository } from "@/db/job-repository";
import type { Config } from "@/shared/config";
import { ErrorCode } from "@/shared/errors";
import { JobStatus, type Response } from "@/shared/types";
import { calculateNextRun } from "@/utils/cron";
import { killProcessTree } from "@/utils/process";

export function createRoutes(
  repo: JobRepository,
  schedulerInstance: CronJobManager,
  executeJobFn: typeof executeJob,
  triggerShutdown: () => void,
  config: Config,
): Hono {
  const app = new Hono();

  const ok = <T>(data: T): Response<T> => ({ ok: true as const, data });
  const err = (error: string, code: ErrorCode): Response<never> => ({
    ok: false as const,
    error,
    code,
  });

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
        ipc: config.daemonIpcPath,
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
    if (!job) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);
    return c.json(ok(job));
  });

  // Add job
  app.post("/api/v1/jobs", async (c) => {
    const body = await c.req.json();
    const { name, script_path, cron } = body;

    if (!name || !script_path || !cron) {
      return c.json(
        err("Missing required fields: name, script_path, cron", ErrorCode.ValidationError),
        400,
      );
    }

    const absolutePath = resolve(script_path);

    try {
      calculateNextRun(cron);
    } catch {
      return c.json(err(`Invalid cron expression: ${cron}`, ErrorCode.ValidationError), 400);
    }

    const nextRun = calculateNextRun(cron);
    try {
      await repo.add({
        name,
        script_path: absolutePath,
        cron,
        next_run_time: nextRun,
      });

      const job = await repo.getByName(name);
      if (job) schedulerInstance.schedule(job);

      return c.json(ok({ name, next_run_time: nextRun }), 201);
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return c.json(err(`Task '${name}' already exists`, ErrorCode.NameConflict), 409);
      }
      throw e;
    }
  });

  // Edit job
  app.patch("/api/v1/jobs/:name", async (c) => {
    const name = c.req.param("name");
    const existing = await repo.getByName(name);
    if (!existing) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);

    const body = await c.req.json();
    const updates: Record<string, unknown> = {};

    if (body.script_path) {
      const absPath = resolve(body.script_path);
      updates.script_path = absPath;
    }
    if (body.cron) {
      try {
        calculateNextRun(body.cron);
      } catch {
        return c.json(err(`Invalid cron expression: ${body.cron}`, ErrorCode.ValidationError), 400);
      }
      updates.cron = body.cron;
      updates.next_run_time = calculateNextRun(body.cron);
    }

    if (Object.keys(updates).length === 0) {
      return c.json(err("No changes specified", ErrorCode.ValidationError), 400);
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
    if (!deleted) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);
    return c.json(ok({ deleted: name }));
  });

  // Run job
  app.post("/api/v1/jobs/:name/run", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);
    if (job.status === JobStatus.Running) {
      return c.json(err(`Task '${name}' is already running`, ErrorCode.AlreadyRunning), 409);
    }

    const updated = await repo.markAsRunning(job.id);
    if (!updated) {
      return c.json(err(`Task '${name}' is already running`, ErrorCode.AlreadyRunning), 409);
    }

    // Fire and forget
    executeJobFn(repo, updated, config, { truncateLog: true }).catch(() => {});

    return c.json(ok({ triggered: name }));
  });

  // Kill job
  app.post("/api/v1/jobs/:name/kill", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);
    if (job.status !== JobStatus.Running || !job.pid) {
      return c.json(err(`Task '${name}' is not running`, ErrorCode.ValidationError), 400);
    }

    try {
      await killProcessTree(job.pid, true);
      return c.json(ok({ killed: name }));
    } catch (e) {
      return c.json(err(`Failed to kill task: ${e}`, ErrorCode.ValidationError), 500);
    }
  });

  // Kill all
  app.post("/api/v1/jobs/kill-all", async (c) => {
    const jobs = await repo.getAll();
    let killed = 0;
    for (const job of jobs) {
      if (job.status === JobStatus.Running && job.pid) {
        try {
          await killProcessTree(job.pid, true);
          killed++;
        } catch (e) {
          // ignore
        }
      }
    }
    return c.json(ok({ killed }));
  });

  // Get logs for a job
  app.get("/api/v1/jobs/:name/logs", async (c) => {
    const name = c.req.param("name");
    const job = await repo.getByName(name);
    if (!job) return c.json(err(`Task '${name}' not found`, ErrorCode.JobNotFound), 404);

    const lines = parseInt(c.req.query("lines") || "0", 10) || 0;
    const logPath = join(config.logsDir, `${name}.log`);

    try {
      const content = await Bun.file(logPath).text();
      if (lines > 0) {
        const allLines = content.split("\n");
        return c.json(ok({ content: allLines.slice(-lines).join("\n") }));
      }
      return c.json(ok({ content }));
    } catch (_e: any) {
      return c.json(ok({ content: "" }));
    }
  });

  // Get all logs summary
  app.get("/api/v1/logs", async (c) => {
    const jobs = await repo.getAll();
    const logs: Record<string, string> = {};
    const logsDir = config.logsDir;
    for (const job of jobs) {
      const logPath = join(logsDir, `${job.name}.log`);
      try {
        const content = await Bun.file(logPath).text();
        // Extract only the last execution block using the new log marker format
        const markerRegex = /={80}\n\[RUN STARTED\]/g;
        const blocks = content.split(markerRegex);

        if (blocks.length > 1) {
          // Get the last non-empty block
          const lastBlock = blocks[blocks.length - 1];
          // Re-attach the stripped marker for context
          logs[job.name] =
            "================================================================================\n[RUN STARTED]" +
            (lastBlock || "");
        } else {
          logs[job.name] = content;
        }
      } catch {
        logs[job.name] = "";
      }
    }
    return c.json(ok(logs));
  });

  // Shutdown
  app.post("/api/v1/daemon/shutdown", (c) => {
    triggerShutdown();
    return c.json(ok({ shutting_down: true }));
  });

  return app;
}
