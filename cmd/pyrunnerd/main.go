package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/DropGuard/pyrunner/internal/config"
	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
)

func main() {
	cfg := config.New()
	if err := cfg.EnsureEnv(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create directories: %v\n", err)
		os.Exit(1)
	}

	// Clean up stale socket
	os.Remove(cfg.DaemonIpcPath)

	// Open database
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	repo := db.NewRepository(database)

	// Cleanup stale jobs from previous crash
	if err := repo.CleanupStaleJobs(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to cleanup stale jobs: %v\n", err)
	}

	scheduler := daemon.NewCronJobManager()
	executor := daemon.NewExecutor(repo, cfg)

	// Load and schedule existing jobs
	jobs, err := repo.GetAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load jobs: %v\n", err)
		os.Exit(1)
	}

	now := time.Now().UnixMilli()
	for _, job := range jobs {
		job := job // capture
		// Catch up missed jobs
		if job.NextRunTime <= now && job.Status != db.JobStatusRunning {
			go executor.ExecuteJob(&job, false)
		}
		// Schedule all jobs
		scheduler.Schedule(job.Name, job.Cron, func() {
			executor.ExecuteJob(&job, false)
		})
	}

	fmt.Printf("PyRunner daemon started with %d jobs\n", len(jobs))

	// Start HTTP server on Unix socket
	server := daemon.NewServer(repo, scheduler, executor, cfg)
	router := server.Router()

	listener, err := net.Listen("unix", cfg.DaemonIpcPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen on socket: %v\n", err)
		os.Exit(1)
	}

	httpServer := &http.Server{Handler: router}

	// Setup shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	daemon.ShutdownFn = func() {
		fmt.Println("Shutting down...")
		scheduler.StopAll()
		httpServer.Close()
		database.Close()
		os.Remove(cfg.DaemonIpcPath)
		os.Exit(0)
	}

	go func() {
		<-sigChan
		daemon.ShutdownFn()
	}()

	if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}
