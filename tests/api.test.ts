import { describe, expect, test } from "bun:test";
import { createRoutes } from "../src/daemon/routes";
import { createDb } from "../src/db/index";
import { JobRepository } from "../src/db/job-repository";
import { Config } from "../src/shared/config";
import { JobStatus } from "../src/shared/types";

function createTestApp() {
  const config = new Config();
  const db = createDb(":memory:");
  const repo = new JobRepository(db);
  const schedulerMock = {
    schedule: () => {},
    unschedule: () => {},
  } as any;
  const executeJobMock = async () => {};
  const triggerShutdownMock = () => {};
  const app = createRoutes(repo, schedulerMock, executeJobMock, triggerShutdownMock, config);
  return { app, repo };
}

describe("API Routes", () => {
  test("GET /api/v1/health returns ok", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ok");
  });

  test("GET /api/v1/jobs returns empty list", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs");
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data).toEqual([]);
  });

  test("POST /api/v1/jobs succeeds even if script not found", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "test-job",
        script_path: "missing.py",
        cron: "0 12 * * *",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
  });

  test("GET /api/v1/jobs/:name returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent");
    expect(res.status).toBe(404);
  });

  test("DELETE /api/v1/jobs/:name returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
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
    await repo.add({
      name: "run-test",
      script_path: "test.py",
      cron: "* * * * *",
      next_run_time: Date.now(),
    });

    const res = await app.request("/api/v1/jobs/run-test/run", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const job = await repo.getByName("run-test");
    expect(job?.status).toBe(JobStatus.Running);
  });

  test("POST /api/v1/jobs/:name/kill returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent/kill", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/v1/jobs/:name/kill returns 400 for idle job", async () => {
    const { app, repo } = createTestApp();
    await repo.add({
      name: "idle-test",
      script_path: "test.py",
      cron: "* * * * *",
      next_run_time: Date.now(),
    });

    const res = await app.request("/api/v1/jobs/idle-test/kill", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/v1/jobs/:name/logs returns 404 for missing job", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs/nonexistent/logs");
    expect(res.status).toBe(404);
  });

  test("POST /api/v1/jobs with invalid cron returns 400", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "bad-cron",
        script_path: "test.py",
        cron: "invalid",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/v1/jobs with missing fields returns 400", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "missing-fields",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
