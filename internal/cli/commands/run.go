package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "run [name]",
		Short: "Manually run a task (all idle tasks if no name given)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return runAllIdle()
			}
			if err := client.RunJob(args[0]); err != nil {
				return err
			}
			printSuccess(fmt.Sprintf("Task '%s' triggered", args[0]))
			return nil
		},
	}
}

func runAllIdle() error {
	jobs, err := client.ListJobs()
	if err != nil {
		return err
	}

	count := 0
	for _, job := range jobs {
		status, _ := job["status"].(string)
		name, _ := job["name"].(string)
		if status != "running" {
			if err := client.RunJob(name); err != nil {
				printWarn(fmt.Sprintf("Failed to trigger '%s': %v", name, err))
			} else {
				count++
			}
		}
	}

	if count == 0 {
		printInfo("No idle tasks to run")
	} else {
		printSuccess(fmt.Sprintf("Triggered %d idle task(s)", count))
	}
	return nil
}
