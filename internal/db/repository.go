package db

import (
	"time"

	"github.com/jmoiron/sqlx"
)

const jobColumns = "id, name, script_path, cron, next_run_time, status, last_run_time, last_exit_code, pid"

type Repository struct {
	db *sqlx.DB
}

func NewRepository(db *sqlx.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetAll() ([]Job, error) {
	var jobs []Job
	err := r.db.Select(&jobs, "SELECT "+jobColumns+" FROM jobs")
	return jobs, err
}

func (r *Repository) GetByName(name string) (*Job, error) {
	var job Job
	err := r.db.Get(&job, "SELECT "+jobColumns+" FROM jobs WHERE name = ?", name)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (r *Repository) GetDueJobs(now int64) ([]Job, error) {
	var jobs []Job
	err := r.db.Select(&jobs, "SELECT "+jobColumns+" FROM jobs WHERE next_run_time <= ? AND status != ?", now, JobStatusRunning)
	return jobs, err
}

func (r *Repository) MarkAsRunning(id int64) (*Job, error) {
	now := time.Now().UnixMilli()
	result, err := r.db.Exec(
		"UPDATE jobs SET status = ?, last_run_time = ? WHERE id = ? AND status != ?",
		JobStatusRunning, now, id, JobStatusRunning,
	)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, nil // already running
	}
	return r.getByID(id)
}

func (r *Repository) getByID(id int64) (*Job, error) {
	var job Job
	err := r.db.Get(&job, "SELECT "+jobColumns+" FROM jobs WHERE id = ?", id)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

// Finalize marks a job idle/failed after a run ends and records its exit
// status. next_run_time is advanced to max(current, nextRun): a manual run
// passes its unchanged existing value, while a scheduled/catch-up winner or a
// duplicate-skip loser passes the next future occurrence. Using MAX means a
// manual run can never roll back an advance the scheduler already made while
// that manual run was in flight.
func (r *Repository) Finalize(id int64, exitCode int, nextRun int64, status JobStatus) error {
	_, err := r.db.Exec(
		"UPDATE jobs SET status = ?, last_exit_code = ?, next_run_time = MAX(next_run_time, ?), pid = NULL WHERE id = ?",
		status, exitCode, nextRun, id,
	)
	return err
}

func (r *Repository) Add(job AddJobRequest, nextRunTime int64) error {
	_, err := r.db.Exec(
		"INSERT INTO jobs (name, script_path, cron, next_run_time, status) VALUES (?, ?, ?, ?, ?)",
		job.Name, job.ScriptPath, job.Cron, nextRunTime, JobStatusIdle,
	)
	return err
}

func (r *Repository) Update(name string, data EditJobRequest, nextRunTime *int64) error {
	// Build dynamic UPDATE
	query := "UPDATE jobs SET"
	args := []interface{}{}
	sets := []string{}

	if data.ScriptPath != nil {
		sets = append(sets, " script_path = ?")
		args = append(args, *data.ScriptPath)
	}
	if data.Cron != nil {
		sets = append(sets, " cron = ?")
		args = append(args, *data.Cron)
	}
	if nextRunTime != nil {
		sets = append(sets, " next_run_time = ?")
		args = append(args, *nextRunTime)
	}
	if len(sets) == 0 {
		return nil
	}

	for i, s := range sets {
		if i == 0 {
			query += s
		} else {
			query += "," + s
		}
	}
	query += " WHERE name = ?"
	args = append(args, name)

	_, err := r.db.Exec(query, args...)
	return err
}

func (r *Repository) Delete(name string) (bool, error) {
	result, err := r.db.Exec("DELETE FROM jobs WHERE name = ?", name)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

// AdvanceNextRun moves a job's next_run_time forward without touching its
// status. It is used when a scheduled/catch-up trigger loses the
// duplicate-execution race (the job is already running from an earlier
// trigger): that slot must still be consumed so next_run_time never points
// into the past while the job is in flight — otherwise a daemon restart
// mid-run would see a past-due job and re-run it on top of the live process.
// The status is left as-is because the running state belongs to the winning
// execution, which will Finalize (and set the final next_run_time) itself.
func (r *Repository) AdvanceNextRun(id int64, nextRun int64) error {
	_, err := r.db.Exec(
		"UPDATE jobs SET next_run_time = ? WHERE id = ? AND status = ?",
		nextRun, id, JobStatusRunning,
	)
	return err
}

func (r *Repository) UpdatePID(id int64, pid int) error {
	_, err := r.db.Exec("UPDATE jobs SET pid = ? WHERE id = ?", pid, id)
	return err
}

func (r *Repository) CleanupStaleJobs() error {
	_, err := r.db.Exec("UPDATE jobs SET status = ?, pid = NULL WHERE status = ?", JobStatusIdle, JobStatusRunning)
	return err
}
