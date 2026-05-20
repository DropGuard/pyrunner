package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newKillCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "kill [name]",
		Short: "Kill a running task (all running tasks if no name given)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return killAll()
			}
			if err := client.KillJob(args[0]); err != nil {
				return err
			}
			printSuccess(fmt.Sprintf("Task '%s' killed", args[0]))
			return nil
		},
	}
}

func killAll() error {
	killed, err := client.KillAllJobs()
	if err != nil {
		return err
	}
	if killed == 0 {
		printInfo("No running tasks to kill")
	} else {
		printSuccess(fmt.Sprintf("Killed %d running task(s)", killed))
	}
	return nil
}
