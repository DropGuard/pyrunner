package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DropGuard/pyrunner/internal/db"
)

// recordingKiller records every KillTree call instead of signalling real
// processes. It also serves as the ordering assertion: if stale DB rows were
// reset before the kill pass, killRunningJobs would see pid = NULL and never
// invoke the killer at all, so a recorded PID proves the kill happened while
// the row still carried its process identity.
type recordingKiller struct {
	killed []int
}

func (k *recordingKiller) KillTree(pid int, force bool) error {
	k.killed = append(k.killed, pid)
	return nil
}

// runningJob inserts a job, marks it running, and stamps a PID — the exact
// row shape a crashed daemon leaves behind.
func runningJob(t *testing.T, repo *db.Repository, name string, pid int) {
	t.Helper()
	require.NoError(t, repo.Add(db.AddJobRequest{Name: name, ScriptPath: "/tmp/x.py", Cron: "0 12 * * *"}, time.Now().Add(time.Hour).UnixMilli()))

	job, err := repo.GetByName(name)
	require.NoError(t, err)

	updated, err := repo.MarkAsRunning(job.ID)
	require.NoError(t, err)
	require.NotNil(t, updated, "job should transition to running")

	require.NoError(t, repo.UpdatePID(job.ID, pid))
}

// TestCleanupStaleRunningJobsKillsBeforeReset is the behavioral guarantee
// behind cleanupStaleRunningJobs: a daemon crash orphans the process tree
// (uv → python) while the DB row still says running with a PID. Startup must
// reap that tree BEFORE CleanupStaleJobs nulls the pid — otherwise the reset
// makes the orphan unreachable and the scheduler could re-trigger the job on
// top of a live process. A job that is running but has no PID (row written
// before UpdatePID, or pid lost) cannot be killed and is just reset.
func TestCleanupStaleRunningJobsKillsBeforeReset(t *testing.T) {
	repo := openMemRepo(t)
	killer := &recordingKiller{}

	runningJob(t, repo, "crashed-job", 4242)
	require.NoError(t, repo.Add(db.AddJobRequest{Name: "idle-job", ScriptPath: "/tmp/y.py", Cron: "0 12 * * *"}, time.Now().Add(time.Hour).UnixMilli()))

	cleanupStaleRunningJobs(repo, killer)

	assert.Equal(t, []int{4242}, killer.killed, "the orphaned tree must be killed while its row still carries the PID")

	for _, name := range []string{"crashed-job", "idle-job"} {
		job, err := repo.GetByName(name)
		require.NoError(t, err)
		assert.Equal(t, db.JobStatusIdle, job.Status, "job %s should be reset to idle", name)
		assert.Nil(t, job.PID, "job %s should have its pid cleared", name)
	}
}

// TestCleanupStaleRunningJobsWithoutPID covers rows that are running but have
// no PID (e.g. the crash happened between MarkAsRunning and UpdatePID). The
// process cannot be reached, so cleanup only resets the row; it must not
// error or hang.
func TestCleanupStaleRunningJobsWithoutPID(t *testing.T) {
	repo := openMemRepo(t)
	killer := &recordingKiller{}

	require.NoError(t, repo.Add(db.AddJobRequest{Name: "orphan-no-pid", ScriptPath: "/tmp/z.py", Cron: "0 12 * * *"}, time.Now().Add(time.Hour).UnixMilli()))
	job, err := repo.GetByName("orphan-no-pid")
	require.NoError(t, err)
	updated, err := repo.MarkAsRunning(job.ID)
	require.NoError(t, err)
	require.NotNil(t, updated)

	cleanupStaleRunningJobs(repo, killer)

	assert.Empty(t, killer.killed, "nothing to kill without a pid")
	job, err = repo.GetByName("orphan-no-pid")
	require.NoError(t, err)
	assert.Equal(t, db.JobStatusIdle, job.Status, "row should still be reset to idle")
}
