package daemon_test

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DropGuard/pyrunner/internal/cli"
	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

func TestDaemonIntegration(t *testing.T) {
	// Create temp directory for test
	tmpDir := filepath.Join(os.TempDir(), fmt.Sprintf("pyrunner-test-%d", time.Now().UnixNano()))
	os.MkdirAll(tmpDir, 0o755)
	defer os.RemoveAll(tmpDir)

	cfg := config.ForTest(tmpDir)
	cfg.EnsureEnv()

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		t.Fatal(err)
	}

	repo := db.NewRepository(database)
	repo.CleanupStaleJobs()

	scheduler := daemon.NewCronJobManager()
	executor := daemon.NewExecutor(repo, cfg)

	httpServer := &http.Server{}
	shutdownFn := func() {
		scheduler.StopAll()
		if httpServer != nil {
			httpServer.Close()
		}
		database.Close()
		os.Remove(cfg.DaemonIpcPath)
	}

	server := daemon.NewServer(repo, scheduler, executor, cfg, shutdownFn)
	httpServer = &http.Server{Handler: server.Router()}
	defer shutdownFn()

	os.Remove(cfg.DaemonIpcPath)

	listener, err := net.Listen("unix", cfg.DaemonIpcPath)
	if err != nil {
		t.Fatal(err)
	}
	go httpServer.Serve(listener)

	// Wait for daemon to be ready
	testClient := cli.NewClient(cfg.DaemonIpcPath)
	ready := false
	for range 50 {
		health, err := testClient.Health()
		if err == nil && health["status"] == "ok" {
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		t.Fatal("Daemon not ready after 5s")
	}

	// Test health
	health, err := testClient.Health()
	if err != nil {
		t.Fatal(err)
	}
	if health["status"] != "ok" {
		t.Errorf("health status = %v", health["status"])
	}

	// Test daemon status
	status, err := testClient.DaemonStatus()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := status["pid"]; !ok {
		t.Error("daemon status missing pid")
	}

	// Test list jobs (empty)
	jobs, err := testClient.ListJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 0 {
		t.Errorf("expected 0 jobs, got %d", len(jobs))
	}

	// Test add job
	result, err := testClient.AddJob("test-job", "/tmp/test.py", "0 12 * * *")
	if err != nil {
		t.Fatal(err)
	}
	if result["name"] != "test-job" {
		t.Errorf("name = %v", result["name"])
	}

	// Test list jobs (one)
	jobs, err = testClient.ListJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Errorf("expected 1 job, got %d", len(jobs))
	}

	// Test get job logs
	logs, err := testClient.GetJobLogs("test-job", 0)
	if err != nil {
		t.Fatal(err)
	}
	_ = logs

	// Test remove job
	if err := testClient.RemoveJob("test-job"); err != nil {
		t.Fatal(err)
	}

	jobs, _ = testClient.ListJobs()
	if len(jobs) != 0 {
		t.Errorf("expected 0 jobs after delete, got %d", len(jobs))
	}

	// Test shutdown
	if err := testClient.Shutdown(); err != nil {
		t.Fatal(err)
	}
}
