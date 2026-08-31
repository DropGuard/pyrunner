//go:build darwin

package commands

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const launchAgentLabel = "com.dropguard.pyrunner"

func launchAgentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist"), nil
}

// registerAutoStart writes a per-user launchd LaunchAgent plist that runs
// `pyrunner start --hidden` on login. We intentionally do NOT set KeepAlive:
// if the daemon crashes, we let it stay down so the bug is visible. The next
// login brings it back via RunAtLoad.
//
// launchctl is required on every macOS install at /bin/launchctl. If the
// binary isn't on PATH (rare, but possible under a broken shell environment)
// we fail fast rather than leave a half-installed plist behind.
func registerAutoStart(binaryPath string) error {
	if _, err := lookPath("launchctl"); err != nil {
		return fmt.Errorf("launchctl not found on PATH (macOS auto-start requires it): %w", err)
	}

	plistPath, err := launchAgentPath()
	if err != nil {
		return err
	}

	// ~/Library/LaunchAgents is created with 0o755; the plist itself is 0o644
	// (matches Apple's recommendation and what older installers used).
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return err
	}

	plistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>start</string>
        <string>--hidden</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`, launchAgentLabel, binaryPath)

	if err := os.WriteFile(plistPath, []byte(plistContent), 0o644); err != nil {
		return err
	}

	// We intentionally do NOT delete the plist on load failure — leave the
	// half-installed state in place so the user can see what went wrong and
	// retry. (Deleting silently makes debugging harder.)
	if err := exec.Command("launchctl", "load", plistPath).Run(); err != nil {
		return fmt.Errorf("launchctl load %s failed: %w", plistPath, err)
	}
	return nil
}

// unregisterAutoStart removes the LaunchAgent plist. It also tries to unload
// the agent first, but a load/unload failure is *not* an error: the user's
// intent is "delete the plist", and an unloaded / never-loaded agent still
// leaves a valid plist on disk to remove. Whether launchd is currently
// tracking the agent should not block uninstall.
func unregisterAutoStart() error {
	plistPath, err := launchAgentPath()
	if err != nil {
		return err
	}

	if _, lookErr := lookPath("launchctl"); lookErr == nil {
		if unloadErr := exec.Command("launchctl", "unload", plistPath).Run(); unloadErr != nil {
			// Best-effort: ignore failure (agent may not be loaded, or label
			// may not match a loaded job). Surface as a warning, not an error.
			printWarn(fmt.Sprintf("launchctl unload %s failed (continuing): %v", plistPath, unloadErr))
		}
	}

	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
