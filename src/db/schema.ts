import type { ColumnType } from "kysely";

export interface JobsTable {
  id: ColumnType<number, never, never>;
  name: string;
  script_path: string;
  working_dir: string;
  cron: string;
  timeout: number;
  next_run_time: number;
  status: string;
  last_run_time: number | null;
  last_exit_code: number | null;
  pid: number | null;
  created_at: ColumnType<number, number, never>;
}

export interface PyrunnerDB {
  jobs: JobsTable;
}
