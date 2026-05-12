import { Cron } from "croner";

export function calculateNextRun(cronExpr: string, baseTime?: number): number {
  const cron = new Cron(cronExpr);
  const next = baseTime ? cron.nextRun(new Date(baseTime)) : cron.nextRun();
  if (!next) throw new Error(`No next run for cron: ${cronExpr}`);
  return next.getTime();
}
