package commands

import (
	"fmt"
	"strconv"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
	"github.com/spf13/cobra"
)

func newListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List all scheduled tasks",
		Aliases: []string{"ls"},
		RunE: func(cmd *cobra.Command, args []string) error {
			jobs, err := client.ListJobs()
			if err != nil {
				return err
			}
			if len(jobs) == 0 {
				printInfo("No tasks found. Use 'pyrunner add' to create one.")
				return nil
			}
			fmt.Println(renderJobsTable(jobs))
			return nil
		},
	}
	return cmd
}

// renderJobsTable builds the tasks table from raw job maps. Pure function so
// the rendering stays separate from the command plumbing.
func renderJobsTable(jobs []map[string]interface{}) string {
	t := table.New().
		Border(lipgloss.NormalBorder()).
		// Keep the original minimal look: header + separator line,
		// no outer box, no vertical column rules. New() defaults all
		// borders on, so turn everything else off explicitly.
		BorderTop(false).
		BorderBottom(false).
		BorderLeft(false).
		BorderRight(false).
		BorderColumn(false).
		BorderHeader(true).
		Headers("NAME", "STATUS", "EXIT", "CRON", "LAST RUN", "NEXT RUN").
		StyleFunc(func(row, col int) lipgloss.Style {
			// Column gap; the library computes widths from the styled
			// cells, so padding never clashes with ANSI colors.
			st := lipgloss.NewStyle().PaddingRight(2)
			if row == table.HeaderRow {
				return st
			}
			if col == 1 { // STATUS
				switch status, _ := jobs[row]["status"].(string); status {
				case "running":
					return st.Foreground(lipgloss.Color("11")) // yellow
				case "failed", "missing_script":
					return st.Foreground(lipgloss.Color("9")) // red
				default:
					return st.Foreground(lipgloss.Color("10")) // green
				}
			}
			return st
		})

	for _, job := range jobs {
		name, _ := job["name"].(string)
		status, _ := job["status"].(string)
		cron, _ := job["cron"].(string)

		exitStr := "-"
		if ec, ok := job["last_exit_code"].(float64); ok {
			exitStr = strconv.Itoa(int(ec))
		}

		lastRun := "-"
		if lrt, ok := job["last_run_time"].(float64); ok && lrt > 0 {
			lastRun = time.UnixMilli(int64(lrt)).Format("2006-01-02 15:04:05")
		}

		nextRun := "-"
		if nrt, ok := job["next_run_time"].(float64); ok && nrt > 0 {
			nextRun = time.UnixMilli(int64(nrt)).Format("2006-01-02 15:04:05")
		}

		t.Row(name, "● "+status, exitStr, cron, lastRun, nextRun)
	}

	return t.Render()
}
