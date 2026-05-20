import { beforeEach, describe, expect, test } from "bun:test";
import { CronJobManager } from "../src/daemon/scheduler";
import { Config } from "../src/shared/config";
import { JobStatus } from "../src/shared/types";

describe("CronJobManager", () => {
  let manager: CronJobManager;
  let repoMock: any;
  let executeMock: any;
  let config: Config;

  beforeEach(() => {
    config = new Config();
    repoMock = {
      markAsRunning: async (id: number) => ({
        id,
        name: "test",
        script_path: "test.py",
        cron: "* * * * *",
        status: JobStatus.Running,
      }),
    };
    executeMock = async () => {};
    manager = new CronJobManager(config, repoMock, executeMock);
  });

  test("schedule and unschedule a job", () => {
    const job = {
      id: 1,
      name: "job1",
      script_path: "test.py",
      cron: "* * * * *",
      next_run_time: Date.now(),
      status: JobStatus.Idle,
      last_run_time: null,
      last_exit_code: null,
    };

    manager.schedule(job);
    expect(manager.getNextRun("job1")).toBeDefined();

    manager.unschedule("job1");
    expect(manager.getNextRun("job1")).toBeNull();
  });

  test("stopAll clears all scheduled jobs", () => {
    manager.schedule({
      id: 1,
      name: "job1",
      script_path: "1.py",
      cron: "* * * * *",
    } as any);
    manager.schedule({
      id: 2,
      name: "job2",
      script_path: "2.py",
      cron: "* * * * *",
    } as any);

    manager.stopAll();
    expect(manager.getNextRun("job1")).toBeNull();
    expect(manager.getNextRun("job2")).toBeNull();
  });

  test("rescheduling replaces existing cron", () => {
    const job1 = { id: 1, name: "job1", script_path: "1.py", cron: "* * * * *" } as any;
    const job1Updated = { id: 1, name: "job1", script_path: "1.py", cron: "0 0 * * *" } as any;

    manager.schedule(job1);
    const firstRun = manager.getNextRun("job1");

    manager.schedule(job1Updated);
    const secondRun = manager.getNextRun("job1");

    expect(firstRun).not.toEqual(secondRun);
  });
});
