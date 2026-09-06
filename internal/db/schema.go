package db

type JobStatus string

const (
	JobStatusIdle          JobStatus = "idle"
	JobStatusRunning       JobStatus = "running"
	JobStatusFailed        JobStatus = "failed"
	JobStatusMissingScript JobStatus = "missing_script"
)

type Job struct {
	ID           int64     `db:"id" json:"id"`
	Name         string    `db:"name" json:"name"`
	ScriptPath   string    `db:"script_path" json:"script_path"`
	Cron         string    `db:"cron" json:"cron"`
	NextRunTime  int64     `db:"next_run_time" json:"next_run_time"`
	Status       JobStatus `db:"status" json:"status"`
	LastRunTime  *int64    `db:"last_run_time" json:"last_run_time"`
	LastExitCode *int      `db:"last_exit_code" json:"last_exit_code"`
	PID          *int      `db:"pid" json:"pid"`
}

type AddJobRequest struct {
	Name       string `json:"name"`
	ScriptPath string `json:"script_path"`
	Cron       string `json:"cron"`
}

type EditJobRequest struct {
	ScriptPath *string `json:"script_path,omitempty"`
	Cron       *string `json:"cron,omitempty"`
}
