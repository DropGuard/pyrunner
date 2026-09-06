package process

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// ErrScriptNotFound reports that the script path passed to Spawn does not
// exist. Callers (the executor) match it with errors.Is to record the more
// precise missing_script status instead of a generic failure.
var ErrScriptNotFound = errors.New("script not found")

// Job represents a running process for a scheduled job.
type Job struct {
	Cmd        *exec.Cmd
	PID        int
	JobName    string
	stdoutPipe io.ReadCloser
	stderrPipe io.ReadCloser
}

// Spawn starts a Python script via `uv run` and returns the running process.
func Spawn(scriptPath string) (*Job, error) {
	if _, err := os.Stat(scriptPath); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrScriptNotFound, scriptPath)
		}
		return nil, fmt.Errorf("check script %s: %w", scriptPath, err)
	}

	cmd := exec.Command("uv", "run", scriptPath)
	cmd.Dir = filepath.Dir(scriptPath)
	cmd.Env = append(os.Environ(),
		"PYTHONUTF8=1",
		"PYTHONIOENCODING=utf-8",
	)

	// Output is captured through manually created os.Pipe pairs rather than
	// StdoutPipe/StderrPipe. With StdoutPipe, Wait closes the read end the
	// moment the child is reaped, so the documented-correct pattern "drain the
	// pipe to EOF, then Wait" is impossible: reading to EOF can block forever
	// when a grandchild inherited the write end, and Waiting first races the
	// concurrent reader and can drop the tail of the script's output. With
	// pipes the parent owns, the executor decides when to stop draining.
	//
	// The parent's copies of the write ends must be closed right after Start
	// (exec does not do it for *os.File writers), otherwise the parent keeps
	// the pipes open forever and the readers never reach EOF.
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		stdoutR.Close()
		stdoutW.Close()
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}
	cmd.Stdout = stdoutW
	cmd.Stderr = stderrW

	// Process-group and hide-window attributes must be applied before Start.
	// Setpgid in particular only takes effect when the SysProcAttr is set on
	// the parent side at fork time; setting it after Start leaves the child
	// in our process group, and KillTree(-pid, ...) cannot reach the whole
	// spawned Python tree.
	setProcessGroup(cmd)
	setHideWindow(cmd)

	if err := cmd.Start(); err != nil {
		// The child never ran, so nothing holds the write ends except us;
		// close both sides of both pipes. (os.File.Close is idempotent per
		// handle, so a double close is harmless.)
		stdoutR.Close()
		stdoutW.Close()
		stderrR.Close()
		stderrW.Close()
		return nil, fmt.Errorf("start process: %w", err)
	}
	// Hand the write ends to the child: close the parent's copies so EOF
	// reaches the readers once the child — and anything it spawned — closes
	// its side.
	stdoutW.Close()
	stderrW.Close()

	return &Job{
		Cmd:        cmd,
		PID:        cmd.Process.Pid,
		JobName:    filepath.Base(scriptPath),
		stdoutPipe: stdoutR,
		stderrPipe: stderrR,
	}, nil
}

// OutputPipes returns stdout and stderr as readable pipes.
func (j *Job) OutputPipes() (stdout, stderr io.Reader) {
	return j.stdoutPipe, j.stderrPipe
}

// ClosePipes force-closes the read ends of the output pipes. It is used after
// the main process has exited but the readers have not reached EOF — a
// grandchild that inherited the write ends and outlives the script would
// otherwise block the readers (and therefore the run) forever. Closing is
// safe to call multiple times; os.File.Close is idempotent per handle.
func (j *Job) ClosePipes() {
	if j.stdoutPipe != nil {
		j.stdoutPipe.Close()
	}
	if j.stderrPipe != nil {
		j.stderrPipe.Close()
	}
}

// Wait blocks until the process exits and returns the exit code.
func (j *Job) Wait() (int, error) {
	err := j.Cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), nil
	}
	return -1, err
}
