package db

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDB(t *testing.T) *Repository {
	t.Helper()
	db, err := OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	return NewRepository(db)
}

func TestAddAndGetAll(t *testing.T) {
	repo := setupTestDB(t)

	nextRun := time.Now().UnixMilli()
	require.NoError(t, repo.Add(AddJobRequest{Name: "test-job", ScriptPath: "/tmp/test.py", Cron: "0 12 * * *"}, nextRun))

	jobs, err := repo.GetAll()
	require.NoError(t, err)
	require.Len(t, jobs, 1, "should have one job")
	assert.Equal(t, "test-job", jobs[0].Name)
	assert.Equal(t, JobStatusIdle, jobs[0].Status)
}

func TestGetByName(t *testing.T) {
	repo := setupTestDB(t)

	nextRun := time.Now().UnixMilli()
	require.NoError(t, repo.Add(AddJobRequest{Name: "my-job", ScriptPath: "/tmp/my.py", Cron: "*/5 * * * *"}, nextRun))

	job, err := repo.GetByName("my-job")
	require.NoError(t, err)
	assert.Equal(t, "/tmp/my.py", job.ScriptPath)

	_, err = repo.GetByName("nonexistent")
	assert.Error(t, err, "expected error for nonexistent job")
}

func TestGetDueJobs(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	require.NoError(t, repo.Add(AddJobRequest{Name: "past", ScriptPath: "/tmp/p.py", Cron: "* * * * *"}, now-1000))
	require.NoError(t, repo.Add(AddJobRequest{Name: "future", ScriptPath: "/tmp/f.py", Cron: "* * * * *"}, now+100000))

	due, err := repo.GetDueJobs(now)
	require.NoError(t, err)
	require.Len(t, due, 1, "only past job should be due")
	assert.Equal(t, "past", due[0].Name)
}

func TestMarkAsRunning(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	require.NoError(t, repo.Add(AddJobRequest{Name: "job1", ScriptPath: "/tmp/j.py", Cron: "* * * * *"}, now))

	jobs, err := repo.GetAll()
	require.NoError(t, err)
	require.NotEmpty(t, jobs)
	job := jobs[0]

	updated, err := repo.MarkAsRunning(job.ID)
	require.NoError(t, err)
	require.NotNil(t, updated, "expected job to be marked as running")
	assert.Equal(t, JobStatusRunning, updated.Status)
	assert.NotNil(t, updated.LastRunTime, "last_run_time should be set")

	// Second attempt should return nil (already running)
	again, err := repo.MarkAsRunning(job.ID)
	require.NoError(t, err)
	assert.Nil(t, again, "expected nil for already-running job")
}

func TestFinalize(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	require.NoError(t, repo.Add(AddJobRequest{Name: "fin", ScriptPath: "/tmp/f.py", Cron: "* * * * *"}, now))

	jobs, err := repo.GetAll()
	require.NoError(t, err)
	require.NotEmpty(t, jobs)
	job := jobs[0]
	_, err = repo.MarkAsRunning(job.ID)
	require.NoError(t, err)

	nextRun := now + 60000
	require.NoError(t, repo.Finalize(job.ID, 0, nextRun, JobStatusIdle))

	updated, err := repo.GetByName("fin")
	require.NoError(t, err)
	assert.Equal(t, JobStatusIdle, updated.Status)
	assert.NotNil(t, updated.LastExitCode)
	assert.Equal(t, 0, *updated.LastExitCode)
	assert.Nil(t, updated.PID, "pid should be nil after finalize")
}

func TestDelete(t *testing.T) {
	repo := setupTestDB(t)

	require.NoError(t, repo.Add(AddJobRequest{Name: "del", ScriptPath: "/tmp/d.py", Cron: "* * * * *"}, 0))

	deleted, err := repo.Delete("del")
	require.NoError(t, err)
	assert.True(t, deleted)

	deleted, err = repo.Delete("nonexistent")
	require.NoError(t, err)
	assert.False(t, deleted, "expected false for nonexistent")
}

func TestUpdate(t *testing.T) {
	repo := setupTestDB(t)

	require.NoError(t, repo.Add(AddJobRequest{Name: "upd", ScriptPath: "/tmp/old.py", Cron: "0 * * * *"}, 0))

	newPath := "/tmp/new.py"
	require.NoError(t, repo.Update("upd", EditJobRequest{ScriptPath: &newPath}, nil))

	job, err := repo.GetByName("upd")
	require.NoError(t, err)
	assert.Equal(t, "/tmp/new.py", job.ScriptPath)
}

func TestUpdatePID(t *testing.T) {
	repo := setupTestDB(t)

	require.NoError(t, repo.Add(AddJobRequest{Name: "pid", ScriptPath: "/tmp/p.py", Cron: "* * * * *"}, 0))
	jobs, err := repo.GetAll()
	require.NoError(t, err)
	require.NotEmpty(t, jobs)

	require.NoError(t, repo.UpdatePID(jobs[0].ID, 12345))

	job, err := repo.GetByName("pid")
	require.NoError(t, err)
	require.NotNil(t, job.PID)
	assert.Equal(t, 12345, *job.PID)
}

func TestCleanupStaleJobs(t *testing.T) {
	repo := setupTestDB(t)

	require.NoError(t, repo.Add(AddJobRequest{Name: "stale", ScriptPath: "/tmp/s.py", Cron: "* * * * *"}, 0))
	jobs, err := repo.GetAll()
	require.NoError(t, err)
	require.NotEmpty(t, jobs)
	_, err = repo.MarkAsRunning(jobs[0].ID)
	require.NoError(t, err)
	require.NoError(t, repo.UpdatePID(jobs[0].ID, 999))

	require.NoError(t, repo.CleanupStaleJobs())

	job, err := repo.GetByName("stale")
	require.NoError(t, err)
	assert.Equal(t, JobStatusIdle, job.Status)
	assert.Nil(t, job.PID, "pid should be nil after cleanup")
}
