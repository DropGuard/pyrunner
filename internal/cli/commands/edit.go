package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newEditCmd() *cobra.Command {
	var script string
	var cron string

	cmd := &cobra.Command{
		Use:   "edit <name>",
		Short: "Edit a scheduled task",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			updates := map[string]interface{}{}

			if script != "" {
				updates["script_path"] = script
			}
			if cron != "" {
				updates["cron"] = cron
			}

			if len(updates) == 0 {
				return fmt.Errorf("no changes specified (use -s or -c)")
			}

			if _, err := client.EditJob(name, updates); err != nil {
				return err
			}
			printSuccess(fmt.Sprintf("Task '%s' updated", name))
			return nil
		},
	}

	cmd.Flags().StringVarP(&script, "script", "s", "", "New script path")
	cmd.Flags().StringVarP(&cron, "cron", "c", "", "New cron expression")
	return cmd
}
