package commands

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/DropGuard/pyrunner/internal/cli"
	"github.com/DropGuard/pyrunner/internal/config"
)

var (
	cfg    *config.Config
	client *cli.Client
)

var rootCmd = &cobra.Command{
	Use:   "pyrunner",
	Short: "A lightweight Python script scheduler",
	Long:  "PyRunner lets you schedule, manage, and monitor Python tasks using cron expressions.",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Default: start daemon
		return startDaemonBinary(cfg)
	},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Skip for start/daemon/help commands
		name := cmd.Name()
		if name == "start" || name == "daemon" || name == "help" || name == "version" {
			return nil
		}
		if err := cfg.EnsureEnv(); err != nil {
			return fmt.Errorf("ensure env: %w", err)
		}
		// Check uv for add/run commands
		if name == "add" || name == "run" {
			if _, err := execLookPath("uv"); err != nil {
				return fmt.Errorf("'uv' is not installed. Install it from https://docs.astral.sh/uv/")
			}
		}
		return nil
	},
}

func init() {
	cfg = config.New()
	client = cli.NewClient(cfg.DaemonIpcPath)

	rootCmd.Version = "0.2.0"

	// Aliases handled by individual commands
	rootCmd.AddCommand(
		newAddCmd(),
		newListCmd(),
		newRemoveCmd(),
		newStartCmd(),
		newStopCmd(),
		newRunCmd(),
		newKillCmd(),
		newLogsCmd(),
		newEditCmd(),
		newInstallCmd(),
		newUninstallCmd(),
	)
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func execLookPath(name string) (string, error) {
	// Wrapper to allow testing
	return lookPath(name)
}
