package daemon_test

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DropGuard/pyrunner/internal/cli"
	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

func TestDaemonIntegration(t *testing.T) {
	tmpDir := t.TempDir()

	cfg := config.ForTest(tmpDir)
	require.NoError(t, cfg.EnsureEnv())

	database, err := db.Open(cfg.DBPath)
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })

	repo := db.NewRepository(database)
	require.NoError(t, repo.CleanupStaleJobs())

	scheduler := daemon.NewCronJobManager()
	executor := daemon.NewExecutor(repo, cfg)

	os.Remove(cfg.DaemonIpcPath)
	listener, err := net.Listen("unix", cfg.DaemonIpcPath)
	require.NoError(t, err)

	httpServer := &http.Server{Handler: nil}
	shutdown := func() {
		scheduler.StopAll()
		httpServer.Close()
		os.Remove(cfg.DaemonIpcPath)
	}
	server := daemon.NewServer(repo, scheduler, executor, cfg, shutdown)
	httpServer.Handler = server.Router()

	go httpServer.Serve(listener)
	t.Cleanup(shutdown)

	// Wait for daemon to be ready.
	testClient := cli.NewClient(cfg.DaemonIpcPath)
	assert.Eventually(t, func() bool {
		health, err := testClient.Health()
		return err == nil && health["status"] == "ok"
	}, 5*time.Second, 50*time.Millisecond, "daemon should become ready")

	// Test health
	health, err := testClient.Health()
	require.NoError(t, err)
	assert.Equal(t, "ok", health["status"], "health status")

	// Test daemon status
	status, err := testClient.DaemonStatus()
	require.NoError(t, err)
	assert.Contains(t, status, "pid", "daemon status should report pid")

	// Test list jobs (empty)
	jobs, err := testClient.ListJobs()
	require.NoError(t, err)
	assert.Empty(t, jobs, "should start with no jobs")

	// Test add job — with a real script file so the add-time existence check
	// (added to catch typos early) accepts the job.
	scriptPath := filepath.Join(tmpDir, "test_job.py")
	require.NoError(t, os.WriteFile(scriptPath, []byte("print('integration')\n"), 0o644))

	result, err := testClient.AddJob("test-job", scriptPath, "0 12 * * *")
	require.NoError(t, err)
	assert.Equal(t, "test-job", result["name"])

	// Test list jobs (one)
	jobs, err = testClient.ListJobs()
	require.NoError(t, err)
	assert.Len(t, jobs, 1, "should have one job after add")

	// Test get job logs
	_, err = testClient.GetJobLogs("test-job", 0)
	require.NoError(t, err)

	// Test -n line counting: the trailing newline must not surface as an
	// extra empty line, so "-n 1" shows the last real line.
	require.NoError(t, os.WriteFile(filepath.Join(cfg.LogsDir, "test-job.log"), []byte("first\nsecond\n"), 0o600))
	logs, err := testClient.GetJobLogs("test-job", 1)
	require.NoError(t, err)
	assert.Equal(t, "second", logs, "-n 1 should show the last real line, not the trailing newline")

	// Test remove job
	require.NoError(t, testClient.RemoveJob("test-job"))

	jobs, err = testClient.ListJobs()
	require.NoError(t, err)
	assert.Empty(t, jobs, "should be empty after delete")

	// Test shutdown
	require.NoError(t, testClient.Shutdown())
}
