package commands

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/DropGuard/pyrunner/internal/cli"
	"github.com/DropGuard/pyrunner/internal/config"
	apperrors "github.com/DropGuard/pyrunner/internal/errors"
	"github.com/DropGuard/pyrunner/internal/version"
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
		// Check git only for repository-URL adds
		if name == "add" && len(args) > 0 && IsRemoteSource(args[0]) {
			if _, err := execLookPath("git"); err != nil {
				return fmt.Errorf("'git' is not installed; it is required to add tasks from a repository URL")
			}
		}
		return nil
	},
}

func init() {
	cfg = config.New()
	client = cli.NewClient(cfg.DaemonIpcPath)

	rootCmd.Version = version.String()

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
	// SilenceErrors/SilenceUsage: cobra prints a giant usage block on every
	// error by default. Output is controlled here so each failure class gets
	// a terse, actionable message instead.
	rootCmd.SilenceErrors = true
	rootCmd.SilenceUsage = true
	if err := rootCmd.Execute(); err != nil {
		var apiErr *apperrors.APIError
		var offlineErr *apperrors.DaemonOfflineError
		switch {
		case errors.As(err, &apiErr) && apiErr.Code == apperrors.ErrInternal:
			// Server-side failure — not the user's input. The raw code adds
			// nothing here; say plainly that the daemon broke and what it
			// reported, so the user can decide whether to file an issue.
			fmt.Fprintf(os.Stderr, "Error: PyRunner daemon reported an internal error: %s\n", apiErr.Message)
		case errors.As(err, &apiErr):
			fmt.Fprintf(os.Stderr, "Error: %s\n", apiErr.Error())
		case errors.As(err, &offlineErr):
			fmt.Fprintln(os.Stderr, "Error: Scheduler daemon is not running. Start it with 'pyrunner start' or 'pyrunner install'.")
		default:
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
		os.Exit(1)
	}
}

func execLookPath(name string) (string, error) {
	// Wrapper to allow testing
	return lookPath(name)
}
