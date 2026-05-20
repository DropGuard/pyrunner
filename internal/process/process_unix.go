//go:build !windows

package process

import (
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
// waits 500ms, then escalates to SIGKILL.
func KillTree(pid int, force bool) error {
	if force {
		return syscall.Kill(-pid, syscall.SIGKILL)
	}

	// Graceful: SIGTERM, wait, then SIGKILL
	err := syscall.Kill(-pid, syscall.SIGTERM)
	if err != nil {
		// Process already gone or not accessible
		return syscall.Kill(-pid, syscall.SIGKILL)
	}

	time.Sleep(500 * time.Millisecond)
	return syscall.Kill(-pid, syscall.SIGKILL)
}
