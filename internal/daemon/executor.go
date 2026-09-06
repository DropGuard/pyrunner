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

// pipeDrainGrace bounds how long the executor keeps draining a job's output
// pipes after the main process has been reaped. It only elapses when a
// grandchild inherited the pipes and outlived the script; in the normal case
// EOF arrives the instant the child exits. The grace keeps such runs bounded
// while still giving any straggler output a fair chance to land.
const pipeDrainGrace = 2 * time.Second

type Executor struct {
	repo   *db.Repository
	config interface {
		GetLogsDir() string
		GetDefaultTimeout() int
	}
}

// TriggerType identifies why a job is being executed. It drives two things:
//   - the run-type label written into the job log ("Scheduled"/"CatchUp"/"Manual"), and
//   - whether next_run_time is advanced after the run.
//
// Scheduled (cron fired) and CatchUp (missed slot made up at daemon start)
// both consume the schedule and advance next_run_time. Manual (user ran it)
// does NOT advance next_run_time — the user just wants to run it once without
// disturbing the scheduled cadence.
type TriggerType int

const (
	TriggerScheduled TriggerType = iota
	TriggerCatchUp
	TriggerManual
)

// String returns the human-readable label used in logs.
func (t TriggerType) String() string {
	switch t {
	case TriggerScheduled:
		return "Scheduled"
	case TriggerCatchUp:
		return "CatchUp"
	case TriggerManual:
		return "Manual"
	default:
		return "Unknown"
	}
}

// advancesNextRun reports whether this trigger consumes the schedule slot and
// should advance next_run_time.
func (t TriggerType) advancesNextRun() bool {
	return t == TriggerScheduled || t == TriggerCatchUp
}

func NewExecutor(repo *db.Repository, cfg interface {
	GetLogsDir() string
	GetDefaultTimeout() int
}) *Executor {
	return &Executor{repo: repo, config: cfg}
}

func (e *Executor) ExecuteJob(job *db.Job, trigger TriggerType) {
	logPath := filepath.Join(e.config.GetLogsDir(), job.Name+".log")
	startTime := time.Now()

	runType := trigger.String()

	fmt.Printf("[%s] Starting job: %s\n", runType, job.Name)

	// Mark the job as running and stamp last_run_time. Every trigger path
	// (daemon scheduler, catch-up, API create/edit, manual run) funnels
	// through ExecuteJob, so stamping here guarantees last_run_time is kept
	// in sync and status is set to running while the process is in flight.
	//
	// MarkAsRunning is an atomic conditional UPDATE (WHERE status != running),
	// so it doubles as the duplicate-execution guard: if the scheduler fires at
	// the same moment a manual `pyrunner run` is in flight, exactly one caller
	// wins the UPDATE and the loser returns here instead of spawning a second
	// process that would race on the same log file.
	if updated, err := e.repo.MarkAsRunning(job.ID); err == nil && updated != nil {
		job.LastRunTime = updated.LastRunTime
	} else {
		if err != nil {
			fmt.Printf("[%s] Job %s: failed to mark as running, skipping: %v\n", runType, job.Name, err)
		} else {
			fmt.Printf("[%s] Job %s is already running; skipping duplicate trigger\n", runType, job.Name)
		}
		// A scheduled or catch-up trigger that loses the race must still
		// consume its slot: leave next_run_time in the past and a daemon
		// restart mid-run would see a past-due job and start a second process
		// on top of the one that is actually running. The winner's Finalize
		// will then set the same next future occurrence, making this update
		// idempotent.
		if trigger.advancesNextRun() {
			if err := e.repo.AdvanceNextRun(job.ID, e.calcNextRun(job, true, startTime)); err != nil {
				fmt.Printf("[%s] Job %s: failed to advance next run after duplicate skip: %v\n", runType, job.Name, err)
			}
		}
		return
	}

	// Rotate the log if it has grown past 5 MiB so the file never runs away.
	// Newer content goes to <name>.log, the previous content to <name>.log.old.
	// The previous .old is removed first so rotation is atomic-ish even on
	// Windows, where os.Rename refuses to overwrite an existing destination.
	// Any rotation failure is surfaced to stderr (the run still proceeds —
	// a non-rotated oversized log is preferable to a failed run, and the
	// per-run 10 MiB write cap still bounds growth).
	if info, err := os.Stat(logPath); err == nil && info.Size() > 5*1024*1024 {
		oldPath := logPath + ".old"
		if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Failed to remove old log %s: %v\n", oldPath, err)
		}
		if err := os.Rename(logPath, oldPath); err != nil {
			fmt.Printf("Failed to rotate log %s: %v\n", logPath, err)
		}
	}

	// Open the log once and reuse the handle for every write in this run,
	// instead of opening/closing on each append (which is wasteful when a
	// chatty script emits thousands of lines). All writes are serialized by
	// mu, so the handle is never accessed concurrently.
	logMu := &sync.Mutex{}
	logFile, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		// Fall back to no-op logging rather than aborting the run.
		fmt.Printf("Failed to open log %s: %v\n", logPath, err)
	}
	if logFile != nil {
		defer logFile.Close()
	}
	writeLog := func(content string) {
		if logFile == nil {
			return
		}
		logMu.Lock()
		defer logMu.Unlock()
		logFile.WriteString(content)
	}

	// Write run header
	writeLog(fmt.Sprintf(
		"\n================================================================================\n"+
			"[RUN STARTED] | Type: %s | Time: %s\n"+
			"================================================================================\n",
		runType, startTime.Format(time.RFC3339),
	))

	// Spawn process
	proc, err := process.Spawn(job.ScriptPath)
	if err != nil {
		fmt.Printf("Failed to spawn job %s: %v\n", job.Name, err)
		nextRun := e.calcNextRun(job, trigger.advancesNextRun(), startTime)
		e.repo.Finalize(job.ID, -1, nextRun, db.JobStatusFailed)
		writeLog(fmt.Sprintf("\nERROR: Failed to spawn: %v\n", err))
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
			writeLog(fmt.Sprintf("\n[TIMEOUT] Job exceeded %ds and was killed.\n", timeoutSec))
		case <-timeoutDone:
		}
	}()

	// Stream output
	stdout, stderr := proc.OutputPipes()

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
				writeLog("\n[LOG TRUNCATED: Exceeded 10MB limit]\n")
			}
			return
		}
		writtenBytes += int64(len(text))
		writeLog(text)
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

	// Reap the process while the readers drain the pipes. The readers reach
	// EOF only once every write end is closed — the child's at exit, and (in
	// the normal case) nothing else holds them, so EOF lands within moments of
	// the exit. Waiting concurrently (instead of reaping first) is what makes
	// the capture lossless: os/exec closes StdoutPipe read ends during Wait,
	// so reaping before the readers finish races them and can discard the
	// tail of the script's output — the most interesting part, e.g. the final
	// error line.
	waitDone := make(chan struct{})
	var exitCode int
	var waitErr error
	go func() {
		exitCode, waitErr = proc.Wait()
		close(waitDone)
	}()

	drained := make(chan struct{})
	go func() {
		wg.Wait()
		close(drained)
	}()

	<-waitDone
	select {
	case <-drained:
		// All output captured.
	case <-time.After(pipeDrainGrace):
		// The main process is gone but the pipes are still open: a grandchild
		// inherited the write ends and outlived the script. The run's output
		// is complete by definition, so stop waiting on the orphan — force-
		// close the read ends to unblock the readers, then wait for them.
		proc.ClosePipes()
		<-drained
	}
	close(timeoutDone)

	if waitErr != nil {
		fmt.Printf("Job %s wait error: %v\n", job.Name, waitErr)
	}

	// Finalize
	nextRun := e.calcNextRun(job, trigger.advancesNextRun(), startTime)
	duration := time.Since(startTime).Seconds()
	e.repo.Finalize(job.ID, exitCode, nextRun, db.JobStatusIdle)

	status := "Success"
	if exitCode != 0 {
		status = "Failed"
	}
	writeLog(fmt.Sprintf(
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

func (e *Executor) calcNextRun(job *db.Job, advance bool, baseTime time.Time) int64 {
	if !advance {
		return job.NextRunTime
	}
	next, err := CalculateNextRun(job.Cron, baseTime)
	if err != nil {
		return 0
	}
	return next.UnixMilli()
}
