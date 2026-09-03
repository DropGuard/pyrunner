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
				// Keep all user state — jobs.sqlite, logs/, repos/ — so a later
				// `pyrunner install` can pick the scheduled tasks right back up
				// (README FAQ: without -w, state is preserved for a reinstall).
				// Only the runtime socket is removed: it is a stale artifact and
				// the daemon recreates it on next start.
				os.Remove(filepath.Join(cfg.PyrunnerDir, "daemon.sock"))
				printSuccess("PyRunner uninstalled (task database, logs and repos preserved)")
			}
			return nil
		},
	}

	cmd.Flags().BoolVarP(&wipe, "wipe", "w", false, "Remove all data including logs and database")
	return cmd
}
