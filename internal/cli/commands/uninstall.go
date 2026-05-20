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
			time.Sleep(500 * time.Millisecond)

			// Disable auto-start
			if err := unregisterAutoStart(); err != nil {
				printWarn(fmt.Sprintf("Could not disable auto-start: %v", err))
			}

			// Cleanup binaries
			printInfo("Removing binaries...")
			os.RemoveAll(cfg.BinDir)

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
