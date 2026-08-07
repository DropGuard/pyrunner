//go:build linux

package daemon_test

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	tmpDir := filepath.Join(os.TempDir(), fmt.Sprintf("pyrunner-run-test-%d", time.Now().UnixNano()))
	os.MkdirAll(tmpDir, 0o755)
	defer os.RemoveAll(tmpDir)

	// Copy the shim into a temp dir and chmod it, so the executable bit never
	// depends on how the testdata file was checked into git.
	fakeBin := filepath.Join(tmpDir, "fakebin")
	os.MkdirAll(fakeBin, 0o755)
	shim, err := os.ReadFile(filepath.Join("testdata", "fakebin", "uv"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fakeBin, "uv"), shim, 0o755); err != nil {
		t.Fatal(err)
	}
	oldPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeBin+string(os.PathListSeparator)+oldPath)
	defer os.Setenv("PATH", oldPath)

	script := filepath.Join(tmpDir, "hello.py")
	if err := os.WriteFile(script, []byte("print('integration ok')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

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

	server := daemon.NewServer(repo, scheduler, executor, cfg)
	os.Remove(cfg.DaemonIpcPath)
	listener, err := net.Listen("unix", cfg.DaemonIpcPath)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := &http.Server{Handler: server.Router()}

	daemon.ShutdownFn = func() {
		scheduler.StopAll()
		httpServer.Close()
		database.Close()
		os.Remove(cfg.DaemonIpcPath)
	}
	go httpServer.Serve(listener)
	defer daemon.ShutdownFn()

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

	if _, err := testClient.AddJob("run-job", script, "0 12 * * *"); err != nil {
		t.Fatal(err)
	}
	if err := testClient.RunJob("run-job"); err != nil {
		t.Fatal(err)
	}

	// Poll until the job finishes, then assert exit code and log content.
	deadline := time.Now().Add(10 * time.Second)
	for {
		jobs, err := testClient.ListJobs()
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range jobs {
			if j["name"] != "run-job" {
				continue
			}
			status, _ := j["status"].(string)
			if status == "running" {
				break
			}
			if ec, _ := j["last_exit_code"].(float64); int(ec) != 0 {
				t.Fatalf("job exited with code %v", j["last_exit_code"])
			}
			logs, err := testClient.GetJobLogs("run-job", 0)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(logs, "integration ok") {
				t.Errorf("logs missing script output: %q", logs)
			}
			if !strings.Contains(logs, "RUN FINISHED") {
				t.Errorf("logs missing RUN FINISHED marker: %q", logs)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("job did not finish within 10s")
		}
		time.Sleep(200 * time.Millisecond)
	}
}
