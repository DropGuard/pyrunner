package commands

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

const defaultCron = "0 12 * * *"

func newAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <name> <script> | <url> [cron]",
		Short: "Add a new scheduled task",
		Args:  cobra.RangeArgs(1, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			// <url> [cron] — task name is the repo name
			if IsRemoteSource(args[0]) {
				cron := defaultCron
				if len(args) > 1 {
					cron = args[1]
				}
				return addRemote(args[0], cron)
			}

			// <name> <script> [cron] — local script path
			if len(args) < 2 {
				return fmt.Errorf("local add requires a name and script path: pyrunner add <name> <script> [cron]")
			}
			cron := defaultCron
			if len(args) > 2 {
				cron = args[2]
			}
			return addLocal(args[0], args[1], cron)
		},
	}
}

func addLocal(name, script, cron string) error {
	result, err := client.AddJob(name, script, cron)
	if err != nil {
		return err
	}
	printSuccess(fmt.Sprintf("Task '%s' added (next run: %v)", name, result["next_run_time"]))
	return nil
}

// addRemote clones url (shallow snapshot) into ~/.pyrunner/repos/<name>,
// defaulting the entrypoint to main.py at the repo root. Fails without side
// effects: the daemon must be reachable before cloning, and a failed clone or
// add cleans up the cloned directory.
func addRemote(url, cron string) error {
	name := RepoNameFromURL(url)
	if name == "" {
		return fmt.Errorf("could not determine repo name from %q", url)
	}

	// Fail before touching disk if the daemon isn't reachable.
	if _, err := client.Health(); err != nil {
		return err
	}

	repoDir := filepath.Join(cfg.ReposDir, name)
	if _, err := os.Stat(repoDir); err == nil {
		return fmt.Errorf("repo %s already cloned at %s — remove the task and re-add to refresh", name, repoDir)
	}

	if err := cloneRepo(url, repoDir); err != nil {
		os.RemoveAll(repoDir)
		return err
	}

	entrypoint := filepath.Join(repoDir, "main.py")
	if _, err := os.Stat(entrypoint); os.IsNotExist(err) {
		printWarn(fmt.Sprintf("no main.py at the repo root; task will fail until you run: pyrunner edit %s -s <entrypoint>", name))
	} else if err != nil {
		os.RemoveAll(repoDir)
		return err
	}

	result, err := client.AddJob(name, entrypoint, cron)
	if err != nil {
		os.RemoveAll(repoDir)
		return err
	}
	printSuccess(fmt.Sprintf("Task '%s' added from %s (next run: %v)", name, url, result["next_run_time"]))
	return nil
}
