package commands

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
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
			// so remove + re-add fetches a fresh copy.
			os.RemoveAll(filepath.Join(cfg.ReposDir, args[0]))
			printSuccess(fmt.Sprintf("Task '%s' removed", args[0]))
			return nil
		},
	}
}
