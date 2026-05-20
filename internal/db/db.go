package db

import (
	"fmt"

	_ "github.com/glebarez/sqlite"
	"github.com/jmoiron/sqlx"
)

const schema = `
CREATE TABLE IF NOT EXISTS jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE,
	script_path TEXT,
	cron TEXT,
	next_run_time INTEGER,
	status TEXT DEFAULT 'idle',
	last_run_time INTEGER,
	last_exit_code INTEGER,
	pid INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs (next_run_time);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
`

func Open(path string) (*sqlx.DB, error) {
	db, err := sqlx.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}
	if _, err := db.Exec("PRAGMA synchronous = NORMAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set synchronous: %w", err)
	}

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}

	// Migration: add pid column if missing (for existing databases)
	db.Exec("ALTER TABLE jobs ADD COLUMN pid INTEGER")

	return db, nil
}

func OpenMemory() (*sqlx.DB, error) {
	return Open(":memory:")
}

// Ensure sqlx is used
var _ *sqlx.DB
