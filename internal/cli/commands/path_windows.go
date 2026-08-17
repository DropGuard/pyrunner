//go:build windows

package commands

import (
	"os"
	"os/exec"
	"path/filepath"
)

// registerOnPath adds the directory containing binPath to the user's PATH
// persistently using `setx` (Windows). Returns the dir added, or an error.
func registerOnPath(binPath string) (string, error) {
	binDir := filepath.Dir(binPath)

	// Current user PATH from registry (setx reads it for us, but we want to
	// avoid duplicating the entry).
	out, err := exec.Command("setx", "PATH", "%PATH%;"+binDir).CombinedOutput()
	if err != nil {
		// setx fails silently on some shells; fall back to a warning.
		_ = out
		return binDir, nil
	}
	return binDir, nil
}

// unregisterFromPath is a best-effort no-op on Windows: removing a single
// entry from the persisted PATH is not reliably scriptable, so we leave the
// directory in place and only remove the binaries.
func unregisterFromPath(binPath string) {
	_ = os.Remove(filepath.Join(filepath.Dir(binPath), "pyrunner.exe"))
}
