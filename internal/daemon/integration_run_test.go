//go:build linux

package daemon_test

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DropGuard/pyrunner/internal/cli"
	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

// TestDaemonRunToCompletion runs a job all the way to completion and asserts
// the output lands in the log. A fake `uv` shim on PATH (testdata/fakebin/uv,
// a POSIX shell script — hence the linux build tag) replaces the real one so
// the test needs no uv install. This would have caught the historical
// StdoutPipe-after-Start bug: every job used to die at pipe setup.
func TestDaemonRunToCompletion(t *testing.T) {
	tmpDir := t.TempDir()

	// Copy the shim into a temp dir and chmod it, so the executable bit never
	// depends on how the testdata file was checked into git.
	fakeBin := filepath.Join(tmpDir, "fakebin")
	require.NoError(t, os.MkdirAll(fakeBin, 0o755))
	shim, err := os.ReadFile(filepath.Join("testdata", "fakebin", "uv"))
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(fakeBin, "uv"), shim, 0o755))
	oldPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeBin+string(os.PathListSeparator)+oldPath)
	defer os.Setenv("PATH", oldPath)

	script := filepath.Join(tmpDir, "hello.py")
	require.NoError(t, os.WriteFile(script, []byte("print('integration ok')\n"), 0o644))

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

	testClient := cli.NewClient(cfg.DaemonIpcPath)
	assert.Eventually(t, func() bool {
		health, err := testClient.Health()
		return err == nil && health["status"] == "ok"
	}, 5*time.Second, 50*time.Millisecond, "daemon should become ready")

	_, err = testClient.AddJob("run-job", script, "0 12 * * *")
	require.NoError(t, err)
	require.NoError(t, testClient.RunJob("run-job"))

	// Poll until the job finishes, then assert exit code and log content.
	// EventuallyWithT retries the closure until it no longer calls
	// collect.Error (i.e. the job is no longer running and finished cleanly).
	assert.EventuallyWithT(t, func(collect *assert.CollectT) {
		jobs, err := testClient.ListJobs()
		if err != nil {
			collect.Errorf("list jobs: %v", err)
			return
		}
		for _, j := range jobs {
			if j["name"] != "run-job" {
				continue
			}
			status, _ := j["status"].(string)
			if status == "running" {
				collect.Errorf("job still running")
				return
			}
			if ec, _ := j["last_exit_code"].(float64); int(ec) != 0 {
				collect.Errorf("job exited with code %v", j["last_exit_code"])
				return
			}
			logs, err := testClient.GetJobLogs("run-job", 0)
			if err != nil {
				collect.Errorf("get logs: %v", err)
				return
			}
			if !strings.Contains(logs, "integration ok") {
				collect.Errorf("logs missing script output: %q", logs)
			}
			if !strings.Contains(logs, "RUN FINISHED") {
				collect.Errorf("logs missing RUN FINISHED marker: %q", logs)
			}
			return
		}
		collect.Errorf("run-job not found in job list")
	}, 10*time.Second, 200*time.Millisecond, "job should finish with exit 0 and expected log output")
}
