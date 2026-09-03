package commands

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

var lookPath = exec.LookPath

// ownerRepoPattern matches the bare "owner/repo" shorthand. Both segments must
// be GitHub-style identifiers with no dots, so it can never collide with
// relative paths like "scripts/daily_report.py". Repos with dots in the name
// should be given as a full https:// URL instead.
var ownerRepoPattern = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9][A-Za-z0-9_-]{0,100})$`)

// IsRemoteSource reports whether arg looks like a Git repository reference
// (https://…, git@…, or owner/repo shorthand) rather than a local script path.
func IsRemoteSource(arg string) bool {
	arg = strings.TrimSpace(arg)
	if strings.HasPrefix(arg, "https://") || strings.HasPrefix(arg, "http://") || strings.HasPrefix(arg, "git@") {
		return true
	}
	return ownerRepoPattern.MatchString(arg)
}

// RepoNameFromURL extracts the task name — the repo segment — from a clone
// URL or owner/repo shorthand. Returns "" when no repo segment can be found.
func RepoNameFromURL(arg string) string {
	arg = strings.TrimSpace(arg)

	// git@host:owner/repo.git
	if strings.HasPrefix(arg, "git@") {
		if i := strings.IndexByte(arg, ':'); i >= 0 {
			arg = arg[i+1:]
		}
	} else if i := strings.Index(arg, "://"); i >= 0 {
		// https://host/owner/repo.git — keep the path after the host
		rest := arg[i+3:]
		if j := strings.IndexByte(rest, '/'); j >= 0 {
			arg = rest[j+1:]
		}
	}

	arg = strings.TrimSuffix(arg, "/")
	parts := strings.Split(arg, "/")
	name := strings.TrimSuffix(parts[len(parts)-1], ".git")
	return strings.ToLower(name)
}

// cloneRepo shallow-clones url into destDir, streaming git output to the
// terminal so progress is visible.
func cloneRepo(url, destDir string) error {
	printInfo(fmt.Sprintf("Cloning %s ...", url))
	cmd := exec.Command("git", "clone", "--depth", "1", url, destDir)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git clone failed: %w", err)
	}
	return nil
}

// Color styles
var (
	successStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("10")) // green
	errorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))  // red
	warnStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("11")) // yellow
	infoStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("14")) // cyan
	boldStyle    = lipgloss.NewStyle().Bold(true)
)

func printSuccess(msg string) {
	fmt.Println(successStyle.Render("[OK] " + msg))
}

func printWarn(msg string) {
	fmt.Println(warnStyle.Render("[WARN] " + msg))
}

func printInfo(msg string) {
	fmt.Println(infoStyle.Render("[INFO] " + msg))
}

// copyFile atomically copies src to dst. It writes to a temp file in the
// same directory then renames it into place, so the destination is never left
// half-written if the process is interrupted. On Windows, an existing dst
// that is locked (e.g. a running binary) makes the rename fail; callers that
// replace a running binary should retry after the old process exits.
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	// Rename trick: move the existing file out of the way first.
	// This prevents ERROR_SHARING_VIOLATION on Windows if the binary is running.
	oldPath := dst + ".old"
	_ = os.Remove(oldPath)
	_ = os.Rename(dst, oldPath)

	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}

	// Rename is atomic on the same filesystem.
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(oldPath, dst) // rollback
		return err
	}

	// Clean up if possible (succeeds instantly on Unix, fails silently on Windows if locked)
	_ = os.Remove(oldPath)
	return nil
}

// withRetry runs op repeatedly until it succeeds, sleeping between attempts,
// and gives up after timeout. It is used to replace a running binary on
// Windows: the old process holds the exe open until it exits, so the
// replace/delete only succeeds once the lock is released. Rather than guess
// how long to sleep, we poll the actual operation — the lock is gone exactly
// when the operation succeeds. Returns the last error if timeout is reached.
func withRetry(op func() error, timeout, interval time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		if err := op(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			return lastErr
		}
		time.Sleep(interval)
	}
}
