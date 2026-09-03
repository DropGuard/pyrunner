package process

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Test seams for resolveUVPath. Kept as package vars so unit tests can stub
// PATH lookup and the home directory without touching the real environment.
var (
	uvLookPath = exec.LookPath
	uvHomeDir  = os.UserHomeDir
	uvGetenv   = os.Getenv
)

// resolveUVPath returns the absolute path of the uv binary to spawn.
//
// The daemon is often launched from a login agent (.desktop / LaunchAgent /
// Run key) whose PATH is minimal and may not include ~/.local/bin (the
// default install location for `curl ... | sh` uv installs and pipx).
// exec.Command("uv", ...) would then silently degrade the next time the
// parent re-resolves PATH; resolving once here and passing the absolute
// path makes the child independent of the daemon's PATH.
func resolveUVPath() (string, error) {
	// 1. Explicit override wins over everything.
	if p := uvGetenv("PYRUNNER_UV"); p != "" {
		return p, nil
	}
	// 2. Ask the PATH for uv.
	if p, err := uvLookPath("uv"); err == nil {
		return p, nil
	}
	// 3. Fall back to the per-user bin dir (uv's default install location).
	home, err := uvHomeDir()
	if err == nil && home != "" {
		candidates := []string{filepath.Join(home, ".local", "bin", "uv")}
		if runtime.GOOS == "windows" {
			candidates = []string{filepath.Join(home, ".local", "bin", "uv.exe")}
		}
		for _, c := range candidates {
			if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
				return c, nil
			}
		}
	}
	return "", fmt.Errorf("uv not found: install from https://docs.astral.sh/uv or set PYRUNNER_UV")
}

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

	uvPath, err := resolveUVPath()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(uvPath, "run", scriptPath)
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

	// Process-group and hide-window attributes must be applied before Start.
	// Setpgid in particular only takes effect when the SysProcAttr is set on
	// the parent side at fork time; setting it after Start leaves the child
	// in our process group, and KillTree(-pid, ...) cannot reach the whole
	// spawned Python tree.
	setProcessGroup(cmd)
	setHideWindow(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start process: %w", err)
	}

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
