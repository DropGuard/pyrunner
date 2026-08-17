package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/spf13/cobra"

	"github.com/DropGuard/pyrunner/internal/cli"
)

func newInstallCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "install",
		Short: "Install PyRunner as a system service",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := cfg.EnsureEnv(); err != nil {
				return fmt.Errorf("create directories: %w", err)
			}

			execPath, err := os.Executable()
			if err != nil {
				return fmt.Errorf("resolve binary: %w", err)
			}
			ext := filepath.Ext(execPath)

			// Stop existing daemon FIRST (binary may be locked on Windows)
			printInfo("Stopping existing daemon (if running)...")
			stopClient := cli.NewClient(cfg.DaemonIpcPath)
			stopClient.Shutdown()

			// Deploy CLI binary. Skip when the source is already the target
			// (upgrading an installed version: execPath == bin/pyrunner), since
			// copying a file onto itself is a no-op and would hit a Windows
			// lock conflict.
			cliTarget := filepath.Join(cfg.BinDir, "pyrunner"+ext)
			if execPath != cliTarget {
				printInfo(fmt.Sprintf("Installing CLI: %s", cliTarget))
				// Retry: if the old daemon (or a prior CLI instance) still holds
				// the file open on Windows, the rename fails until the lock is
				// released.
				if err := withRetry(func() error { return copyFile(execPath, cliTarget) }, 5*time.Second, 200*time.Millisecond); err != nil {
					return fmt.Errorf("deploy CLI binary: %w", err)
				}
			}

			// Deploy daemon binary (must be next to the CLI binary)
			daemonSource := findDaemonBinary(execPath)
			if daemonSource == "" {
				return fmt.Errorf("pyrunnerd%s not found next to %s — build it first with: go build ./cmd/pyrunnerd/", ext, execPath)
			}
			daemonTarget := filepath.Join(cfg.BinDir, "pyrunnerd"+ext)
			// Skip when already in place (upgrade of an installed version).
			if daemonSource != daemonTarget {
				printInfo(fmt.Sprintf("Installing daemon: %s", daemonTarget))
				if err := withRetry(func() error { return copyFile(daemonSource, daemonTarget) }, 5*time.Second, 200*time.Millisecond); err != nil {
					return fmt.Errorf("deploy daemon binary: %w", err)
				}
			}

			// Register auto-start
			if err := registerAutoStart(cliTarget); err != nil {
				printWarn(fmt.Sprintf("Could not register auto-start: %v", err))
			} else {
				printInfo("Registered for auto-start on login")
			}

			// Add the CLI binary to the user's PATH so `pyrunner` is directly
			// callable from any shell.
			if linkPath, err := registerOnPath(cliTarget); err != nil {
				printWarn(fmt.Sprintf("Could not add to PATH: %v", err))
			} else {
				printInfo(fmt.Sprintf("Added to PATH: %s", linkPath))
			}

			// Start daemon. Wait for the old daemon to actually exit (Health
			// stops responding) so the fresh binary is what starts — otherwise
			// startDaemonBinary would see the lingering process as "already
			// running" and skip, leaving the new binary unloaded.
			printInfo("Waiting for old daemon to stop...")
			startClient := cli.NewClient(cfg.DaemonIpcPath)
			if err := withRetry(func() error {
				if _, err := startClient.Health(); err == nil {
					return fmt.Errorf("daemon still running")
				}
				return nil
			}, 5*time.Second, 200*time.Millisecond); err != nil {
				printWarn("Old daemon did not stop in time; it may hold the binary lock")
			}

			printInfo("Starting daemon...")
			if err := startDaemonBinary(cfg); err != nil {
				printWarn(fmt.Sprintf("Could not start daemon: %v (start manually with 'pyrunner start')", err))
			}

			printSuccess("PyRunner installed successfully")
			return nil
		},
	}
}

func findDaemonBinary(cliPath string) string {
	dir := filepath.Dir(cliPath)
	ext := filepath.Ext(cliPath)
	candidate := filepath.Join(dir, "pyrunnerd"+ext)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	if runtime.GOOS != "windows" {
		candidate = filepath.Join(dir, "pyrunnerd")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}
