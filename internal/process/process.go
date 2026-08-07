package process

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Job represents a running process for a scheduled job.
type Job struct {
	Cmd        *exec.Cmd
	PID        int
	JobName    string
	stdoutPipe io.Reader
	stderrPipe io.Reader
}

// Spawn starts a Python script via `uv run` and returns the running process.
func Spawn(scriptPath string) (*Job, error) {
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("script not found: %s", scriptPath)
	}

	cmd := exec.Command("uv", "run", scriptPath)
	cmd.Dir = filepath.Dir(scriptPath)
	cmd.Env = append(os.Environ(),
		"PYTHONUTF8=1",
		"PYTHONIOENCODING=utf-8",
	)

	// Pipes must be created before Start, or StdoutPipe/StderrPipe fail
	// with "exec: StdoutPipe after process started".
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	setHideWindow(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start process: %w", err)
	}

	setProcessGroup(cmd)

	return &Job{
		Cmd:        cmd,
		PID:        cmd.Process.Pid,
		JobName:    filepath.Base(scriptPath),
		stdoutPipe: stdoutPipe,
		stderrPipe: stderrPipe,
	}, nil
}

// OutputPipes returns stdout and stderr as readable pipes.
func (j *Job) OutputPipes() (stdout, stderr io.Reader, err error) {
	return j.stdoutPipe, j.stderrPipe, nil
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
