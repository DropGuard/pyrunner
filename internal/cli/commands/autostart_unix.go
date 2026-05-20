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
`, binaryPath)

	desktopPath := filepath.Join(autostartDir, "pyrunner.desktop")
	return os.WriteFile(desktopPath, []byte(desktopContent), 0o644)
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
