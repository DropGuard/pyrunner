package daemon

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/DropGuard/pyrunner/internal/db"
	"github.com/DropGuard/pyrunner/internal/process"
)

type Executor struct {
	repo   *db.Repository
	config interface {
		GetLogsDir() string
		GetDefaultTimeout() int
	}
}

func NewExecutor(repo *db.Repository, cfg interface {
	GetLogsDir() string
	GetDefaultTimeout() int
}) *Executor {
	return &Executor{repo: repo, config: cfg}
}

func (e *Executor) ExecuteJob(job *db.Job, truncateLog bool) {
	logPath := filepath.Join(e.config.GetLogsDir(), job.Name+".log")
	startTime := time.Now()

	isDue := job.NextRunTime <= startTime.UnixMilli()
	runType := "Scheduled"
	if !isDue {
		runType = "Manual"
	}

	fmt.Printf("[%s] Starting job: %s\n", runType, job.Name)

	// Handle log rotation/truncation
	if truncateLog {
		os.WriteFile(logPath, []byte{}, 0o644)
	} else {
		if info, err := os.Stat(logPath); err == nil && info.Size() > 5*1024*1024 {
			os.Rename(logPath, logPath+".old")
		}
	}

	// Write run header
	e.appendLog(logPath, fmt.Sprintf(
		"\n================================================================================\n"+
			"[RUN STARTED] | Type: %s | Time: %s\n"+
			"================================================================================\n",
		runType, startTime.Format(time.RFC3339),
	))

	// Spawn process
	proc, err := process.Spawn(job.ScriptPath)
	if err != nil {
		fmt.Printf("Failed to spawn job %s: %v\n", job.Name, err)
		nextRun := e.calcNextRun(job, isDue, startTime)
		e.repo.Finalize(job.ID, -1, nextRun, db.JobStatusFailed)
		e.appendLog(logPath, fmt.Sprintf("\nERROR: Failed to spawn: %v\n", err))
		return
	}

	e.repo.UpdatePID(job.ID, proc.PID)

	// Timeout
	timeoutDone := make(chan struct{})
	timeoutSec := e.config.GetDefaultTimeout()
	go func() {
		select {
		case <-time.After(time.Duration(timeoutSec) * time.Second):
			fmt.Printf("Job %s timed out after %ds. Killing tree...\n", job.Name, timeoutSec)
			process.KillTree(proc.PID, false)
			e.appendLog(logPath, fmt.Sprintf("\n[TIMEOUT] Job exceeded %ds and was killed.\n", timeoutSec))
		case <-timeoutDone:
		}
	}()

	// Stream output
	stdout, stderr, err := proc.OutputPipes()
	if err != nil {
		fmt.Printf("Failed to get pipes for %s: %v\n", job.Name, err)
		e.appendLog(logPath, fmt.Sprintf("\nERROR: Failed to get output pipes: %v\n", err))
		close(timeoutDone)
		nextRun := e.calcNextRun(job, isDue, startTime)
		e.repo.Finalize(job.ID, -1, nextRun, db.JobStatusFailed)
		return
	}

	var mu sync.Mutex
	var writtenBytes int64
	const maxRunBytes = 10 * 1024 * 1024 // 10MB
	var truncatedPrinted bool

	writeToLog := func(text string) {
		mu.Lock()
		defer mu.Unlock()
		if writtenBytes > maxRunBytes {
			if !truncatedPrinted {
				truncatedPrinted = true
				e.appendLog(logPath, "\n[LOG TRUNCATED: Exceeded 10MB limit]\n")
			}
			return
		}
		writtenBytes += int64(len(text))
		e.appendLog(logPath, text)
	}

	// Stream stdout and stderr concurrently
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		e.streamToLog(stdout, writeToLog)
	}()
	go func() {
		defer wg.Done()
		e.streamToLog(stderr, writeToLog)
	}()

	// Wait for process exit
	exitCode, waitErr := proc.Wait()
	wg.Wait()
	close(timeoutDone)

	if waitErr != nil {
		fmt.Printf("Job %s wait error: %v\n", job.Name, waitErr)
	}

	// Finalize
	nextRun := e.calcNextRun(job, isDue, startTime)
	duration := time.Since(startTime).Seconds()
	e.repo.Finalize(job.ID, exitCode, nextRun, db.JobStatusIdle)

	status := "Success"
	if exitCode != 0 {
		status = "Failed"
	}
	e.appendLog(logPath, fmt.Sprintf(
		"--------------------------------------------------------------------------------\n"+
			"[RUN FINISHED] | Status: %s | Duration: %.1fs | Exit Code: %d | Time: %s\n"+
			"--------------------------------------------------------------------------------\n",
		status, duration, exitCode, time.Now().Format(time.RFC3339),
	))

	if exitCode == 0 {
		fmt.Printf("Job %s completed successfully.\n", job.Name)
	} else {
		fmt.Printf("Job %s failed with exit code %d.\n", job.Name, exitCode)
	}
}

func (e *Executor) streamToLog(r io.Reader, write func(string)) {
	decoder := &process.SmartDecoder{}
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			text := decoder.Decode(buf[:n])
			if text != "" {
				write(text)
			}
		}
		if err != nil {
			text := decoder.Flush()
			if text != "" {
				write(text)
			}
			break
		}
	}
}

func (e *Executor) appendLog(path, content string) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(content)
}

func (e *Executor) calcNextRun(job *db.Job, isDue bool, baseTime time.Time) int64 {
	if !isDue {
		return job.NextRunTime
	}
	next, err := CalculateNextRun(job.Cron, baseTime)
	if err != nil {
		return 0
	}
	return next.UnixMilli()
}
