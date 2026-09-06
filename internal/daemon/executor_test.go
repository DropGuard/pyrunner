package daemon_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

// TestExecuteJobMissingScript verifies that a job whose script has vanished
// finalizes into the missing_script status (not the generic failed status),
// so the task list can tell the user to repoint the entrypoint instead of
// just reporting a red failure.
func TestExecuteJobMissingScript(t *testing.T) {
	tmpDir := t.TempDir()
	cfg := config.ForTest(tmpDir)
	require.NoError(t, cfg.EnsureEnv())

	database, err := db.OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	repo := db.NewRepository(database)

	executor := daemon.NewExecutor(repo, cfg)

	require.NoError(t, repo.Add(db.AddJobRequest{
		Name:       "gone",
		ScriptPath: filepath.Join(tmpDir, "nope.py"),
		Cron:       "0 12 * * *",
	}, time.Now().Add(time.Hour).UnixMilli()))

	job, err := repo.GetByName("gone")
	require.NoError(t, err)

	executor.ExecuteJob(job, daemon.TriggerManual)

	updated, err := repo.GetByName("gone")
	require.NoError(t, err)
	assert.Equal(t, db.JobStatusMissingScript, updated.Status, "a vanished script should surface as missing_script")
	require.NotNil(t, updated.LastExitCode)
	assert.Equal(t, -1, *updated.LastExitCode, "spawn failure records exit code -1")
	assert.Nil(t, updated.PID, "no process was spawned, pid must be cleared")
}
