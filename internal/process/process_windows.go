//go:build windows

package process

import (
	"fmt"
	"os/exec"
	"time"
)

func setProcessGroup(cmd *exec.Cmd) {
	// Windows: taskkill /T handles the process tree
}

func setHideWindow(cmd *exec.Cmd) {
	// TODO: set cmd.SysProcAttr.HideWindow = true via golang.org/x/sys/windows
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
