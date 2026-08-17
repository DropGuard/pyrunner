package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

func newUninstallCmd() *cobra.Command {
	var wipe bool

	cmd := &cobra.Command{
		Use:   "uninstall",
		Short: "Uninstall PyRunner from the system",
		RunE: func(cmd *cobra.Command, args []string) error {
			// Stop daemon
			printInfo("Stopping daemon...")
			if err := client.Shutdown(); err != nil {
				printWarn("Daemon not running or not responding")
			}

			// Disable auto-start
			if err := unregisterAutoStart(); err != nil {
				printWarn(fmt.Sprintf("Could not disable auto-start: %v", err))
			}

			// Remove the CLI symlink from PATH (best-effort)
			unregisterFromPath(filepath.Join(cfg.BinDir, "pyrunner"+filepath.Ext(os.Args[0])))

			// Cleanup binaries. Retry so a still-running daemon (which holds the
			// exe open on Windows) has a chance to exit and release the lock;
			// report an error rather than silently leaving binaries behind.
			printInfo("Removing binaries...")
			if err := withRetry(func() error { return os.RemoveAll(cfg.BinDir) }, 5*time.Second, 200*time.Millisecond); err != nil {
				return fmt.Errorf("remove binaries: %w", err)
			}

			if wipe {
				printInfo("Removing all data...")
				os.RemoveAll(cfg.PyrunnerDir)
				printSuccess("PyRunner fully uninstalled (all data removed)")
			} else {
				// Only remove bin, keep logs and db
				keepFiles := []string{"jobs.sqlite", "daemon.sock"}
				for _, f := range keepFiles {
					os.Remove(filepath.Join(cfg.PyrunnerDir, f))
				}
				printSuccess("PyRunner uninstalled (logs preserved in " + cfg.LogsDir + ")")
			}
			return nil
		},
	}

	cmd.Flags().BoolVarP(&wipe, "wipe", "w", false, "Remove all data including logs and database")
	return cmd
}
