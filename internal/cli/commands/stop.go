package commands

import (
	"github.com/spf13/cobra"
)

func newStopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the scheduler daemon",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := client.Shutdown(); err != nil {
				return err
			}
			printSuccess("Daemon stopped")
			return nil
		},
	}
}
