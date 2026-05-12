import { Database } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { DB_PATH } from "../shared/config";
import type { PyrunnerDB } from "./schema";

export type { PyrunnerDB } from "./schema";

/**
 * Adapter that wraps bun:sqlite's Database to match the SqliteDatabase
 * interface that Kysely's SqliteDialect expects (better-sqlite3 compatible).
 */
function wrapBunSqlite(db: InstanceType<typeof Database>) {
  return {
    close() {
      db.close();
    },
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        get reader() {
          const upper = sql.trimStart().toUpperCase();
          return (
            upper.startsWith("SELECT") || upper.startsWith("PRAGMA") || upper.includes("RETURNING")
          );
        },
        all(params: ReadonlyArray<unknown>) {
          // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite requires spread params
          return stmt.all(...(params as any[]));
        },
        run(params: ReadonlyArray<unknown>) {
          // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite requires spread params
          const result = stmt.run(...(params as any[]));
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        iterate(params: ReadonlyArray<unknown>) {
          // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite requires spread params
          return stmt.values(...(params as any[]))[Symbol.iterator]();
        },
      };
    },
  };
}

export function createDb(path: string = DB_PATH): Kysely<PyrunnerDB> {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      script_path TEXT,
      working_dir TEXT,
      cron TEXT,
      timeout INTEGER DEFAULT 600,
      next_run_time INTEGER,
      status TEXT DEFAULT 'idle',
      last_run_time INTEGER,
      last_exit_code INTEGER,
      pid INTEGER,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs (next_run_time);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
  `);

  return new Kysely<PyrunnerDB>({
    // biome-ignore lint/suspicious/noExplicitAny: adapter is compatible but types don't match exactly
    dialect: new SqliteDialect({ database: wrapBunSqlite(sqlite) as any }),
  });
}
