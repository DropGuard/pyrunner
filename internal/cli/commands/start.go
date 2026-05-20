package commands

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"
)

var hidden bool

func newStartCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "start",
		Short:   "Start the scheduler daemon",
		Aliases: []string{"daemon"},
		RunE: func(cmd *cobra.Command, args []string) error {
			return startDaemonBinary(cfg)
		},
	}
	cmd.Flags().BoolVar(&hidden, "hidden", false, "Start hidden (no output)")
	return cmd
}

// startDaemonBinary finds and spawns the pyrunnerd binary as a background process.
func startDaemonBinary(cfg2 interface{ EnsureEnv() error }) error {
	if err := cfg2.EnsureEnv(); err != nil {
		return fmt.Errorf("create directories: %w", err)
	}

	daemonPath, err := locateDaemonBinary()
	if err != nil {
		return err
	}

	// Check if daemon is already running by trying to connect
	testClient := client
	if _, err := testClient.Health(); err == nil {
		printInfo("Daemon is already running")
		return nil
	}

	printInfo(fmt.Sprintf("Starting daemon: %s", daemonPath))

	cmd := exec.Command(daemonPath)

	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = getHideWindowAttr()
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start daemon: %w", err)
	}

	go cmd.Process.Release()
	printSuccess("Daemon started")
	return nil
}

func locateDaemonBinary() (string, error) {
	execPath, err := os.Executable()
	if err != nil {
		return "", err
	}
	ext := filepath.Ext(execPath)
	candidate := filepath.Join(filepath.Dir(execPath), "pyrunnerd"+ext)
	if _, err := os.Stat(candidate); err == nil {
		return candidate, nil
	}
	return "", fmt.Errorf("pyrunnerd%s not found next to %s", ext, execPath)
}
