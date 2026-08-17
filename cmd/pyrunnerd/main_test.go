package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

// fakeRunner records which jobs it was asked to execute, so tests can assert
// the catch-up selection without spawning real processes. It signals via a
// channel when a job is dispatched, so tests can wait synchronously instead
// of sleeping.
type fakeRunner struct {
	jobs chan string
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{jobs: make(chan string, 16)}
}

func (f *fakeRunner) ExecuteJob(job *db.Job, trigger daemon.TriggerType) {
	f.jobs <- job.Name
}

// openMemRepo returns an in-memory repository with the schema applied.
func openMemRepo(t *testing.T) *db.Repository {
	t.Helper()
	database, err := db.OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return db.NewRepository(database)
}

// addJobWithNextRun adds a job with an explicit next_run_time.
func addJobWithNextRun(t *testing.T, repo *db.Repository, name string, nextRun time.Time) {
	t.Helper()
	require.NoError(t, repo.Add(db.AddJobRequest{Name: name, ScriptPath: "/tmp/x.py", Cron: "0 12 * * *"}, nextRun.UnixMilli()))
}

// TestCatchUpRunsPastDueJob verifies that on daemon startup, a job whose
// next_run is already in the past is run once to make up for the missed slot.
//
// NOTE: this is NOT "going back in time to replay missed runs". robfig/cron
// schedules only future occurrences, so a job missed while the daemon was
// down would otherwise never run. The catch-up exists to fire it once (e.g. a
// daily check-in that was missed because the daemon was stopped). After the
// catch-up run, next_run_time is advanced to the next future occurrence.
func TestCatchUpRunsPastDueJob(t *testing.T) {
	repo := openMemRepo(t)
	runner := newFakeRunner()

	// Job A: next_run 2 hours ago → should be caught up.
	past := time.Now().Add(-2 * time.Hour)
	addJobWithNextRun(t, repo, "past-job", past)

	// Job B: next_run 1 hour from now → should NOT be caught up.
	future := time.Now().Add(1 * time.Hour)
	addJobWithNextRun(t, repo, "future-job", future)

	count := catchUpMissedJobs(repo, runner, time.Now())
	require.Equal(t, 1, count, "only the past-due job should be caught up")

	// Wait synchronously for the dispatched job, with a timeout so a missing
	// dispatch fails fast instead of hanging.
	select {
	case name := <-runner.jobs:
		assert.Equal(t, "past-job", name, "caught-up job")
	case <-time.After(2 * time.Second):
		t.Fatal("catch-up job was not dispatched")
	}

	// No other job should have been dispatched.
	select {
	case name := <-runner.jobs:
		t.Errorf("unexpected extra job dispatched: %q", name)
	case <-time.After(50 * time.Millisecond):
		// expected: no extra jobs
	}
}

// TestCatchUpNoMissedJobs verifies no catch-up when all jobs are future-due.
func TestCatchUpNoMissedJobs(t *testing.T) {
	repo := openMemRepo(t)
	runner := newFakeRunner()

	future := time.Now().Add(2 * time.Hour)
	addJobWithNextRun(t, repo, "a", future)
	addJobWithNextRun(t, repo, "b", future)

	count := catchUpMissedJobs(repo, runner, time.Now())
	require.Zero(t, count, "expected no catch-up")

	select {
	case name := <-runner.jobs:
		t.Errorf("no jobs should run, got: %q", name)
	case <-time.After(50 * time.Millisecond):
		// expected: no jobs dispatched
	}
}
