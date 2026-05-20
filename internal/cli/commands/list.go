package commands

import (
	"fmt"
	"strconv"
	"time"

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

			// Header
			fmt.Printf("%s  %s  %s  %s  %s  %s\n",
				padRight("NAME", 16),
				padRight("STATUS", 12),
				padRight("EXIT", 6),
				padRight("CRON", 16),
				padRight("LAST RUN", 20),
				padRight("NEXT RUN", 20),
			)
			fmt.Println("────────────────────────────────────────────────────────────────────────────────────────────────────────────────")

			for _, job := range jobs {
				name, _ := job["name"].(string)
				status, _ := job["status"].(string)
				cron, _ := job["cron"].(string)

				exitStr := "-"
				if ec, ok := job["last_exit_code"].(float64); ok && ec != 0 {
					exitStr = strconv.Itoa(int(ec))
				} else if ok {
					exitStr = "0"
				}

				lastRun := "-"
				if lrt, ok := job["last_run_time"].(float64); ok && lrt > 0 {
					lastRun = time.UnixMilli(int64(lrt)).Format("2006-01-02 15:04:05")
				}

				nextRun := "-"
				if nrt, ok := job["next_run_time"].(float64); ok && nrt > 0 {
					nextRun = time.UnixMilli(int64(nrt)).Format("2006-01-02 15:04:05")
				}

				// Pad plain text first, then apply color (ANSI codes break len-based padding)
				statusPadded := padRight(status, 8)
				statusColored := formatStatus(statusPadded)

				fmt.Printf("%s  %s  %s  %s  %s  %s\n",
					padRight(name, 16),
					statusColored,
					padRight(exitStr, 6),
					padRight(cron, 16),
					padRight(lastRun, 20),
					padRight(nextRun, 20),
				)
			}

			return nil
		},
	}
	return cmd
}
