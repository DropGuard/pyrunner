import type { Kysely } from "kysely";
import type { PyrunnerDB } from "@/db/schema";
import type { Job, JobStatus } from "@/shared/types";

export class JobRepository {
  constructor(private db: Kysely<PyrunnerDB>) {}

  async getAll(): Promise<Job[]> {
    return this.db.selectFrom("jobs").selectAll().execute() as Promise<Job[]>;
  }

  async getByName(name: string): Promise<Job | undefined> {
    return this.db
      .selectFrom("jobs")
      .where("name", "=", name)
      .selectAll()
      .executeTakeFirst() as Promise<Job | undefined>;
  }

  async getDueJobs(now: number): Promise<Job[]> {
    return this.db
      .selectFrom("jobs")
      .where("next_run_time", "<=", now)
      .where("status", "!=", "running")
      .selectAll()
      .execute() as Promise<Job[]>;
  }

  async markAsRunning(id: number | undefined): Promise<Job | undefined> {
    if (id === undefined) return undefined;
    return this.db
      .updateTable("jobs")
      .set({ status: "running", last_run_time: Date.now() })
      .where("id", "=", id)
      .where("status", "!=", "running")
      .returningAll()
      .executeTakeFirst() as Promise<Job | undefined>;
  }

  async finalize(
    id: number | undefined,
    exitCode: number,
    nextRun: number,
    status: JobStatus,
  ): Promise<void> {
    if (id === undefined) return;
    await this.db
      .updateTable("jobs")
      .set({ status, last_exit_code: exitCode, next_run_time: nextRun, pid: null })
      .where("id", "=", id)
      .execute();
  }

  async add(job: {
    name: string;
    script_path: string;
    cron: string;
    next_run_time: number;
  }): Promise<void> {
    await this.db
      .insertInto("jobs")
      .values({
        ...job,
        status: "idle",
        pid: null,
      })
      .execute();
  }

  async update(
    name: string,
    data: Partial<Pick<Job, "script_path" | "cron" | "next_run_time">>,
  ): Promise<void> {
    const keys = Object.keys(data);
    if (keys.length === 0) return;
    await this.db.updateTable("jobs").set(data).where("name", "=", name).execute();
  }

  async delete(name: string): Promise<boolean> {
    const result = await this.db.deleteFrom("jobs").where("name", "=", name).executeTakeFirst();
    return result.numDeletedRows > 0;
  }

  async updatePid(id: number, pid: number | null): Promise<void> {
    await this.db.updateTable("jobs").set({ pid }).where("id", "=", id).execute();
  }

  async cleanupStaleJobs(): Promise<void> {
    await this.db
      .updateTable("jobs")
      .set({ status: "idle", pid: null })
      .where("status", "=", "running")
      .execute();
  }
}
