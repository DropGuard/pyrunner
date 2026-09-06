package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
	"github.com/DropGuard/pyrunner/internal/process"
	"github.com/DropGuard/pyrunner/internal/singleton"
)

// processKiller abstracts process-tree termination so tests can assert the
// startup/shutdown cleanup ordering without spawning real processes.
type processKiller interface {
	KillTree(pid int, force bool) error
}

type realProcessKiller struct{}

func (realProcessKiller) KillTree(pid int, force bool) error {
	return process.KillTree(pid, force)
}

// killRunningJobs terminates every process tree the DB currently marks
// running. It is called in two places with opposite but complementary intents:
//
//   - daemon shutdown: so stopping the scheduler never strands Python scripts
//     in the background;
//   - daemon startup (via cleanupStaleRunningJobs): so a crashed daemon's
//     orphans are reaped before their DB rows are reset. Order matters —
//     resetting first would let the scheduler re-trigger a job whose previous
//     process is still alive, and the two runs would race on the same log file.
//
// Kills are graceful (SIGTERM, escalating to SIGKILL after a short grace
// period) so scripts get a chance to flush and clean up, and they run
// concurrently because each graceful kill carries its own escalation delay —
// serializing them would multiply shutdown time by the number of running jobs.
//
// A gracefully-stopped daemon also leaves rows here occasionally: executor
// goroutines may not have Finalized before the database closed, while the
// shutdown path already killed the processes. KillTree on those yields ESRCH,
// which is treated as success — nothing left to kill.
func killRunningJobs(repo *db.Repository, killer processKiller) {
	jobs, err := repo.GetAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to list running jobs for cleanup: %v\n", err)
		return
	}
	var wg sync.WaitGroup
	for _, job := range jobs {
		if job.Status == db.JobStatusRunning && job.PID != nil {
			wg.Add(1)
			go func(pid int, name string) {
				defer wg.Done()
				if err := killer.KillTree(pid, false); err == nil {
					fmt.Printf("Killed running job %s (pid %d)\n", name, pid)
				}
			}(*job.PID, job.Name)
		}
	}
	wg.Wait()
}

// cleanupStaleRunningJobs reaps orphaned process trees left by a crashed
// daemon, then resets their DB rows back to idle. The kill must come first:
// CleanupStaleJobs overwrites pid with NULL, and once the pid is gone the
// still-alive child (uv → python) can never be reached again.
func cleanupStaleRunningJobs(repo *db.Repository, killer processKiller) {
	killRunningJobs(repo, killer)
	if err := repo.CleanupStaleJobs(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to cleanup stale jobs: %v\n", err)
	}
}

// jobRunner abstracts the execution of a single job, so tests can inject a
// fake and assert the catch-up selection without spawning real processes.
type jobRunner interface {
	ExecuteJob(job *db.Job, trigger daemon.TriggerType)
}

// catchUpMissedJobs runs every job whose next_run_time is already in the past
// (and not currently running), compensating for missed slots. This is the
// daemon's catch-up behavior. Each compensated job is executed once; its
// next_run_time is then advanced to a future occurrence by ExecuteJob.
//
// It returns the number of jobs it started running, so callers/tests can
// assert the compensation actually happened.
func catchUpMissedJobs(repo *db.Repository, runner jobRunner, now time.Time) int {
	jobs, err := repo.GetAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load jobs: %v\n", err)
		return 0
	}

	count := 0
	nowMS := now.UnixMilli()
	for _, job := range jobs {
		if job.NextRunTime <= nowMS && job.Status != db.JobStatusRunning {
			job := job // capture
			go runner.ExecuteJob(&job, daemon.TriggerCatchUp)
			count++
		}
	}
	return count
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

	// Reap orphaned process trees from a previous crash, then reset their DB
	// rows to idle. Kill must precede the reset: once CleanupStaleJobs nulls
	// the pid column, a still-alive child can never be reached again.
	cleanupStaleRunningJobs(repo, realProcessKiller{})

	scheduler := daemon.NewCronJobManager()
	executor := daemon.NewExecutor(repo, cfg)

	// Load and schedule existing jobs
	jobs, err := repo.GetAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load jobs: %v\n", err)
		return 1
	}

	// Catch up missed jobs (compensation for time the daemon was down).
	catchUpMissedJobs(repo, executor, time.Now())

	for _, job := range jobs {
		job := job // capture
		// Schedule all jobs. A stored cron that fails to parse must not fail
		// silently — the daemon would report the job as scheduled while it
		// never fires.
		if err := scheduler.Schedule(job.Name, job.Cron, func() {
			executor.ExecuteJob(&job, daemon.TriggerScheduled)
		}); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to schedule job %s (cron %q): %v\n", job.Name, job.Cron, err)
		}
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
	server := daemon.NewServer(repo, scheduler, executor, cfg, nil)
	router := server.Router()
	httpServer := &http.Server{Handler: router}

	// shutdown runs the teardown exactly once. SIGINT/SIGTERM and the HTTP
	// /daemon/shutdown endpoint can race (e.g. `pyrunner stop` while the user
	// hits Ctrl-C); a second close of done would panic, so the once guards
	// every teardown step.
	var shutdownOnce sync.Once
	shutdown := func() {
		shutdownOnce.Do(func() {
			fmt.Println("Shutting down...")
			// Stop cron scheduling first, then kill any in-flight jobs so no
			// child process is left orphaned when the daemon exits.
			scheduler.StopAll()
			killRunningJobs(repo, realProcessKiller{})
			httpServer.Close()
			close(done)
		})
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
