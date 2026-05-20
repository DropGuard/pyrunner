import { Cron } from "croner";
import type { JobRepository } from "@/db/job-repository";
import type { Config } from "@/shared/config";
import type { Job } from "@/shared/types";
import { logger } from "@/utils/logger";

export class CronJobManager {
  private activeJobs = new Map<string, Cron>();

  constructor(
    private config: Config,
    private repo: JobRepository,
    private executeJobFn: (
      repo: JobRepository,
      job: Job,
      config: Config,
      options?: { truncateLog?: boolean },
    ) => Promise<void>,
  ) {}

  schedule(job: Job): void {
    this.unschedule(job.name);

    const cron = new Cron(job.cron, { catch: false }, () => {
      this.repo
        .markAsRunning(job.id)
        .then((updated) => {
          if (updated) {
            this.executeJobFn(this.repo, updated, this.config).catch((err) => {
              logger.error(`Unhandled error in job ${updated.name}:`, err);
            });
          }
        })
        .catch((err) => {
          logger.error(`Failed to mark job ${job.name} as running:`, err);
        });
    });

    this.activeJobs.set(job.name, cron);
  }

  unschedule(name: string): void {
    const existing = this.activeJobs.get(name);
    if (existing) {
      existing.stop();
      this.activeJobs.delete(name);
    }
  }

  stopAll(): void {
    for (const [, cron] of this.activeJobs) {
      cron.stop();
    }
    this.activeJobs.clear();
  }

  getNextRun(name: string): Date | null {
    const cron = this.activeJobs.get(name);
    return cron?.nextRun() ?? null;
  }
}
