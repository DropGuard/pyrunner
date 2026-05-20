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
			time.Sleep(500 * time.Millisecond)

			// Deploy CLI binary
			cliTarget := filepath.Join(cfg.BinDir, "pyrunner"+ext)
			printInfo(fmt.Sprintf("Installing CLI: %s", cliTarget))
			if err := copyFile(execPath, cliTarget); err != nil {
				return fmt.Errorf("deploy CLI binary: %w", err)
			}

			// Deploy daemon binary (must be next to the CLI binary)
			daemonSource := findDaemonBinary(execPath)
			if daemonSource == "" {
				return fmt.Errorf("pyrunnerd%s not found next to %s — build it first with: go build ./cmd/pyrunnerd/", ext, execPath)
			}
			daemonTarget := filepath.Join(cfg.BinDir, "pyrunnerd"+ext)
			printInfo(fmt.Sprintf("Installing daemon: %s", daemonTarget))
			if err := copyFile(daemonSource, daemonTarget); err != nil {
				return fmt.Errorf("deploy daemon binary: %w", err)
			}

			// Register auto-start
			if err := registerAutoStart(cliTarget); err != nil {
				printWarn(fmt.Sprintf("Could not register auto-start: %v", err))
			} else {
				printInfo("Registered for auto-start on login")
			}

			// Start daemon
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
