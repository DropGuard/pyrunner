package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <name> <script> [cron]",
		Short: "Add a new scheduled task",
		Args:  cobra.RangeArgs(2, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			script := args[1]
			cron := "0 12 * * *"
			if len(args) > 2 {
				cron = args[2]
			}

			result, err := client.AddJob(name, script, cron)
			if err != nil {
				return err
			}
			printSuccess(fmt.Sprintf("Task '%s' added (next run: %v)", name, result["next_run_time"]))
			return nil
		},
	}
}
