import { beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index";
import { JobRepository } from "../src/db/job-repository";
import { JobStatus } from "../src/shared/types";

function createTestDb() {
  const db = createDb(":memory:");
  return { db, repo: new JobRepository(db) };
}

describe("JobRepository", () => {
  let repo: JobRepository;

  beforeEach(() => {
    ({ repo } = createTestDb());
  });

  test("add and getByName", async () => {
    await repo.add({
      name: "test-job",
      script_path: "/tmp/test.py",
      cron: "0 12 * * *",
      next_run_time: Date.now() + 86400000,
    });

    const job = await repo.getByName("test-job");
    expect(job).toBeDefined();
    expect(job?.name).toBe("test-job");
    expect(job?.status).toBe(JobStatus.Idle);
  });

  test("getAll returns all jobs", async () => {
    await repo.add({
      name: "job1",
      script_path: "/tmp/1.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });
    await repo.add({
      name: "job2",
      script_path: "/tmp/2.py",
      cron: "0 13 * * *",
      next_run_time: Date.now(),
    });

    const jobs = await repo.getAll();
    expect(jobs.length).toBe(2);
  });

  test("getByName returns undefined for missing job", async () => {
    const job = await repo.getByName("nonexistent");
    expect(job).toBeUndefined();
  });

  test("delete removes a job", async () => {
    await repo.add({
      name: "to-delete",
      script_path: "/tmp/del.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const deleted = await repo.delete("to-delete");
    expect(deleted).toBe(true);

    const job = await repo.getByName("to-delete");
    expect(job).toBeUndefined();
  });

  test("delete returns false for missing job", async () => {
    const deleted = await repo.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  test("markAsRunning sets status to running", async () => {
    await repo.add({
      name: "run-test",
      script_path: "/tmp/run.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("run-test");
    const updated = await repo.markAsRunning(job?.id);
    expect(updated).toBeDefined();
    expect(updated?.status).toBe(JobStatus.Running);
    expect(updated?.last_run_time).toBeGreaterThan(0);
  });

  test("markAsRunning returns undefined for already running job", async () => {
    await repo.add({
      name: "already-running",
      script_path: "/tmp/ar.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("already-running");
    await repo.markAsRunning(job?.id);
    const again = await repo.markAsRunning(job?.id);
    expect(again).toBeUndefined();
  });

  test("finalize updates status and exit code", async () => {
    await repo.add({
      name: "finalize-test",
      script_path: "/tmp/fin.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("finalize-test");
    await repo.markAsRunning(job?.id);
    await repo.finalize(job?.id, 0, Date.now() + 86400000, JobStatus.Idle);

    const updated = await repo.getByName("finalize-test");
    expect(updated?.status).toBe(JobStatus.Idle);
    expect(updated?.last_exit_code).toBe(0);
  });

  test("update modifies job fields", async () => {
    await repo.add({
      name: "update-test",
      script_path: "/tmp/up.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    await repo.update("update-test", { cron: "0 18 * * *" });
    const job = await repo.getByName("update-test");
    expect(job?.cron).toBe("0 18 * * *");
  });

  test("getDueJobs returns jobs past their next_run_time", async () => {
    const past = Date.now() - 1000;
    const future = Date.now() + 86400000;

    await repo.add({
      name: "past-job",
      script_path: "/tmp/past.py",
      cron: "0 12 * * *",
      next_run_time: past,
    });
    await repo.add({
      name: "future-job",
      script_path: "/tmp/future.py",
      cron: "0 12 * * *",
      next_run_time: future,
    });

    const due = await repo.getDueJobs(Date.now());
    expect(due.length).toBe(1);
    expect(due[0]?.name).toBe("past-job");
  });

  test("cleanupStaleJobs resets running jobs to idle", async () => {
    await repo.add({
      name: "stale-job",
      script_path: "/tmp/stale.py",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("stale-job");
    await repo.markAsRunning(job?.id);

    await repo.cleanupStaleJobs();

    const updated = await repo.getByName("stale-job");
    expect(updated?.status).toBe(JobStatus.Idle);
  });
});
