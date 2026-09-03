//go:build windows

package process

import (
	"fmt"
	"os/exec"
	"syscall"
	"time"
)

func setProcessGroup(cmd *exec.Cmd) {
	// Windows: taskkill /T handles the process tree
}

// setHideWindow marks the child for creation without a visible console
// window. Without this, a scheduled script that triggers a fresh console
// allocation (e.g. the daemon was started detached / by a service manager
// with no console to inherit) pops up a black cmd window on the user's
// desktop — exactly what a personal-machine background scheduler must not
// do. Go maps SysProcAttr.HideWindow to STARTF_USESHOWWINDOW with SW_HIDE
// at CreateProcess time.
func setHideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}

// KillTree kills the process tree using taskkill.
// If force is false, tries graceful termination first, then force-kills.
func KillTree(pid int, force bool) error {
	if force {
		return taskkill(pid, true)
	}

	// Graceful: try without /F first
	err := taskkill(pid, false)
	if err != nil {
		return taskkill(pid, true)
	}

	time.Sleep(500 * time.Millisecond)
	return taskkill(pid, true)
}

func taskkill(pid int, force bool) error {
	args := []string{"/T"}
	if force {
		args = append(args, "/F")
	}
	args = append(args, "/PID", fmt.Sprintf("%d", pid))

	cmd := exec.Command("taskkill", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("taskkill: %w: %s", err, output)
	}
	return nil
}
