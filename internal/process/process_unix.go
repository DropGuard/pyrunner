//go:build !windows

package process

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func setHideWindow(cmd *exec.Cmd) {
	// No-op on Unix
}

// KillTree kills the process tree. If force is false, sends SIGTERM first,
// waits 500ms, then escalates to SIGKILL. Killing a tree whose processes have
// already exited (ESRCH) is treated as success: the goal — no surviving
// processes — is already met, and callers that retry kills (daemon shutdown,
// kill-after-timeout) should not see a spurious "failed to kill" error just
// because the graceful phase did its job.
func KillTree(pid int, force bool) error {
	if force {
		return killGroup(pid, syscall.SIGKILL)
	}

	// Graceful: SIGTERM, wait, then SIGKILL
	if err := killGroup(pid, syscall.SIGTERM); err != nil {
		// Could not signal the group (already gone or not accessible).
		return err
	}

	time.Sleep(500 * time.Millisecond)
	return killGroup(pid, syscall.SIGKILL)
}

// killGroup signals a process group. ESRCH (no such process) is swallowed:
// the tree no longer exists, which is exactly the state KillTree promises.
func killGroup(pid int, sig syscall.Signal) error {
	err := syscall.Kill(-pid, sig)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
