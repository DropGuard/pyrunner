//go:build !windows

package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

func registerAutoStart(binaryPath string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	// XDG autostart's Exec key requires an absolute path — a bare "~" is NOT
	// expanded by most desktop environments. Expand it here.
	execPath := expandHome(binaryPath)

	// Create XDG autostart directory
	autostartDir := filepath.Join(home, ".config", "autostart")
	if err := os.MkdirAll(autostartDir, 0o755); err != nil {
		return err
	}

	desktopContent := fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=PyRunner
Exec=%s start --hidden
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`, execPath)

	desktopPath := filepath.Join(autostartDir, "pyrunner.desktop")
	return os.WriteFile(desktopPath, []byte(desktopContent), 0o644)
}

// expandHome converts a leading "~" or "~/..." into the user's home
// directory path. Used for the autostart Exec line, which requires absolute
// paths.
func expandHome(p string) string {
	if p == "~" {
		home, _ := os.UserHomeDir()
		return home
	}
	if len(p) >= 2 && p[0] == '~' && p[1] == '/' {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, p[2:])
	}
	return p
}

func unregisterAutoStart() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	desktopPath := filepath.Join(home, ".config", "autostart", "pyrunner.desktop")
	os.Remove(desktopPath) // ignore error
	return nil
}
