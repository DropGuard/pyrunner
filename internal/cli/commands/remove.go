package commands

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/DropGuard/pyrunner/internal/db"
)

func newRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "remove <name>",
		Short:   "Remove a scheduled task",
		Aliases: []string{"rm"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := client.RemoveJob(args[0]); err != nil {
				return err
			}
			// Best-effort cleanup of the cloned snapshot for git-sourced tasks,
			// so remove + re-add fetches a fresh copy. Guarded by the same
			// validation the daemon applies at add time: this RemoveAll must
			// never reach outside ReposDir, even for a row created before task
			// names were validated.
			if db.ValidateTaskName(args[0]) == nil {
				os.RemoveAll(filepath.Join(cfg.ReposDir, args[0]))
			}
			printSuccess(fmt.Sprintf("Task '%s' removed", args[0]))
			return nil
		},
	}
}
