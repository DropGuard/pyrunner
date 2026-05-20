package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

func newLogsCmd() *cobra.Command {
	var lines int
	cmd := &cobra.Command{
		Use:   "logs [name]",
		Short: "View task logs",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return showAllLogs()
			}
			return showJobLogs(args[0], lines)
		},
	}
	cmd.Flags().IntVarP(&lines, "lines", "n", 0, "Number of lines to show")
	return cmd
}

func showAllLogs() error {
	logs, err := client.GetAllLogs()
	if err != nil {
		return err
	}
	if len(logs) == 0 {
		printInfo("No tasks found")
		return nil
	}

	printInfo("Last Execution Logs for All Tasks")
	for name, content := range logs {
		fmt.Printf("\n%s\n", boldStyle.Render("── "+name+" ──"))
		if content == "" {
			printWarn("  (no logs)")
			continue
		}
		renderLogContent(content)
	}
	return nil
}

func showJobLogs(name string, lines int) error {
	content, err := client.GetJobLogs(name, lines)
	if err != nil {
		return err
	}
	if content == "" {
		printInfo(fmt.Sprintf("No logs found for '%s'", name))
		return nil
	}
	renderLogContent(content)
	return nil
}

func renderLogContent(content string) {
	for _, line := range strings.Split(content, "\n") {
		switch {
		case strings.Contains(line, "[RUN STARTED]"):
			fmt.Println(successStyle.Bold(true).Render(line))
		case strings.Contains(line, "[RUN FINISHED]"):
			fmt.Println(infoStyle.Bold(true).Render(line))
		case strings.Contains(line, "ERROR"):
			fmt.Println(errorStyle.Render(line))
		default:
			fmt.Println(line)
		}
	}
}
