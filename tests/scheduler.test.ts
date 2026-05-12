import { beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { CronJobManager } from "../src/daemon/scheduler";
import { createDb } from "../src/db/index";
import { JobRepository } from "../src/db/job-repository";
import type { PyrunnerDB } from "../src/db/schema";

describe("CronJobManager", () => {
  let db: Kysely<PyrunnerDB>;
  let repo: JobRepository;
  let scheduler: CronJobManager;

  beforeEach(() => {
    db = createDb(":memory:");
    repo = new JobRepository(db);
    scheduler = new CronJobManager();
  });

  test("schedule and unschedule a job", async () => {
    const executed: string[] = [];
    scheduler.initialize(repo, async (_repo, job) => {
      executed.push(job.name);
    });

    await repo.add({
      name: "test-schedule",
      script_path: "/tmp/test.py",
      working_dir: "/tmp",
      cron: "* * * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("test-schedule");
    expect(job).toBeDefined();
    if (!job) return;
    scheduler.schedule(job);

    expect(scheduler.getNextRun("test-schedule")).toBeInstanceOf(Date);

    scheduler.unschedule("test-schedule");
    expect(scheduler.getNextRun("test-schedule")).toBeNull();
  });

  test("stopAll clears all scheduled jobs", async () => {
    scheduler.initialize(repo, async () => {});

    await repo.add({
      name: "job1",
      script_path: "/tmp/1.py",
      working_dir: "/tmp",
      cron: "* * * * *",
      next_run_time: Date.now(),
    });
    await repo.add({
      name: "job2",
      script_path: "/tmp/2.py",
      working_dir: "/tmp",
      cron: "* * * * *",
      next_run_time: Date.now(),
    });

    const job1 = await repo.getByName("job1");
    const job2 = await repo.getByName("job2");
    expect(job1).toBeDefined();
    expect(job2).toBeDefined();
    if (!job1 || !job2) return;
    scheduler.schedule(job1);
    scheduler.schedule(job2);

    scheduler.stopAll();
    expect(scheduler.getNextRun("job1")).toBeNull();
    expect(scheduler.getNextRun("job2")).toBeNull();
  });

  test("rescheduling replaces existing cron", async () => {
    scheduler.initialize(repo, async () => {});

    await repo.add({
      name: "reschedule-test",
      script_path: "/tmp/test.py",
      working_dir: "/tmp",
      cron: "0 12 * * *",
      next_run_time: Date.now(),
    });

    const job = await repo.getByName("reschedule-test");
    expect(job).toBeDefined();
    if (!job) return;
    scheduler.schedule(job);
    const firstNextRun = scheduler.getNextRun("reschedule-test");

    // Reschedule with different cron
    scheduler.schedule({ ...job, cron: "0 18 * * *" });
    const secondNextRun = scheduler.getNextRun("reschedule-test");

    expect(firstNextRun).toBeInstanceOf(Date);
    expect(secondNextRun).toBeInstanceOf(Date);
  });
});
