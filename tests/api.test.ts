import { describe, expect, test } from "bun:test";
import { createRoutes } from "../src/daemon/routes";
import { CronJobManager } from "../src/daemon/scheduler";
import { createDb } from "../src/db/index";
import { JobRepository } from "../src/db/job-repository";
import { JobStatus } from "../src/shared/types";

function createTestApp() {
  const db = createDb(":memory:");
  const repo = new JobRepository(db);
  const scheduler = new CronJobManager();
  const mockExecuteJob = async () => {};
  scheduler.initialize(repo, mockExecuteJob);
  const app = createRoutes(repo, scheduler, mockExecuteJob);
  return { app, repo, db };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for response parsing
async function parseBody(res: Response): Promise<any> {
  return res.json();
}

describe("API Routes", () => {
  test("GET /api/v1/health returns ok", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = await parseBody(res);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ok");
  });

  test("GET /api/v1/jobs returns empty list", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs");
    expect(res.status).toBe(200);
    const body = await parseBody(res);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  test("POST /api/v1/jobs succeeds even if script not found", async () => {
    const { app } = createTestApp();

    const scriptPath = "/tmp/nonexistent-test-script.py";

    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-api-job",
        script_path: scriptPath,
        cron: "0 12 * * *",
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseBody(res);
    expect(body.ok).toBe(true);
  });

  test("GET /api/v1/jobs/:name returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent");
    expect(res.status).toBe(404);
    const body = await parseBody(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("JOB_NOT_FOUND");
  });

  test("DELETE /api/v1/jobs/:name returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = await parseBody(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("JOB_NOT_FOUND");
  });

  test("POST /api/v1/jobs/:name/run returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent/run", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/v1/jobs/:name/run updates job status to running", async () => {
    const { app, repo } = createTestApp();
    const name = "test-run-status";
    const scriptPath = process.execPath;

    // Add a job manually to the repo
    await repo.add({
      name,
      script_path: scriptPath,
      working_dir: ".",
      cron: "0 12 * * *",
      next_run_time: Date.now() + 100000,
    });

    const res = await app.request(`/api/v1/jobs/${name}/run`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const job = await repo.getByName(name);
    expect(job?.status).toBe(JobStatus.Running);
  });

  test("POST /api/v1/jobs/:name/kill returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent/kill", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/v1/jobs/:name/logs returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent/logs");
    expect(res.status).toBe(404);
  });

  test("POST /api/v1/jobs with invalid cron returns 400", async () => {
    const { app } = createTestApp();
    // Use a script path that exists on this system
    const scriptPath = process.execPath; // bun binary always exists
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bad-cron",
        script_path: scriptPath,
        cron: "not-a-cron",
      }),
    });
    expect(res.status).toBe(400);
    const body = await parseBody(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/v1/jobs with missing fields returns 400", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "incomplete" }),
    });
    expect(res.status).toBe(400);
    const body = await parseBody(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});
