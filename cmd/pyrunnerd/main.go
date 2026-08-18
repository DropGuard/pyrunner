package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
	"github.com/DropGuard/pyrunner/internal/process"
	"github.com/DropGuard/pyrunner/internal/singleton"
)

// killRunningJobs force-kills every job currently marked running, so a
// daemon shutdown never leaves orphaned child processes. This is the daemon's
// responsibility: without it, stopping the scheduler would strand Python
// scripts in the background.
func killRunningJobs(repo *db.Repository) {
	jobs, err := repo.GetAll()
	if err != nil {
		return
	}
	for _, job := range jobs {
		if job.Status == db.JobStatusRunning && job.PID != nil {
			if err := process.KillTree(*job.PID, true); err == nil {
				fmt.Printf("Killed running job %s (pid %d)\n", job.Name, *job.PID)
			}
		}
	}
}

func main() {
	os.Exit(run())
}

// run starts the daemon and blocks until it is asked to shut down, returning
// nil for a clean shutdown or a non-nil error for a fatal startup failure.
// Keeping os.Exit in main() (rather than scattering it through run) makes the
// startup/teardown sequence testable and keeps the single exit path explicit.
func run() int {
	cfg := config.New()
	if err := cfg.EnsureEnv(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create directories: %v\n", err)
		return 1
	}

	// --- Singleton guard (atomic, before any side effects) ---
	lock, err := singleton.Acquire(filepath.Join(cfg.PyrunnerDir, "daemon.lock"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "PyRunner daemon is already running: %v\n", err)
		return 1
	}
	defer lock.Release()

	// Open database
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		return 1
	}
	defer database.Close()

	repo := db.NewRepository(database)

	// Cleanup stale jobs from previous crash
	if err := repo.CleanupStaleJobs(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to cleanup stale jobs: %v\n", err)
	}

	executor := daemon.NewExecutor(repo, cfg)
	scheduler := daemon.NewScheduler(repo, executor, 30*time.Second)
	scheduler.Start()
	defer scheduler.Stop()

	jobs, err := repo.GetAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load jobs: %v\n", err)
		return 1
	}

	// Start HTTP server on the Unix socket (clean stale socket file first).
	os.Remove(cfg.DaemonIpcPath)
	listener, err := net.Listen("unix", cfg.DaemonIpcPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen on socket: %v\n", err)
		return 1
	}
	defer os.Remove(cfg.DaemonIpcPath)

	fmt.Printf("PyRunner daemon started (pid %d) with %d jobs\n", os.Getpid(), len(jobs))

	// done is signaled when the daemon should shut down (either via
	// SIGINT/SIGTERM or the HTTP /daemon/shutdown endpoint). It lets the
	// teardown run synchronously in run() instead of os.Exit-ing from inside
	// a goroutine, so defer-based cleanup runs and the exit path is single.
	done := make(chan struct{})

	// Build the Router first, wrap it in an http.Server, then define the
	// teardown closure (which closes that http.Server) and wire it in via
	// SetShutdown so the /daemon/shutdown endpoint can trigger it.
	server := daemon.NewServer(repo, executor, cfg, nil)
	router := server.Router()
	httpServer := &http.Server{Handler: router}

	shutdown := func() {
		fmt.Println("Shutting down...")
		// Stop heartbeat scheduler first, then kill any in-flight jobs so no
		// child process is left orphaned when the daemon exits.
		scheduler.Stop()
		killRunningJobs(repo)
		httpServer.Shutdown(context.Background())
		close(done)
	}
	server.SetShutdown(shutdown)

	// Setup shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		shutdown()
	}()

	// Serve until the server is closed (by shutdown) or an unexpected error.
	serveErr := httpServer.Serve(listener)

	// Wait for the shutdown signal so the deferred cleanup (database.Close,
	// lock.Release, socket removal) runs before returning. If Serve returned
	// for another reason, report it.
	if serveErr != nil && serveErr != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", serveErr)
		return 1
	}

	<-done
	return 0
}
