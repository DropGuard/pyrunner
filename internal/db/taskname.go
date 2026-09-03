package db

import (
	"fmt"
	"regexp"
	"strings"
)

// maxTaskNameLen bounds task names. Names are used verbatim as log file names
// (<name>.log) and as repository directory names (<name> under ReposDir), so
// they must stay short enough to be safe on any filesystem.
const maxTaskNameLen = 128

// taskNameRe allows only filesystem-safe characters: a name must start with a
// letter or digit and continue with letters, digits, '.', '_' or '-'. This
// structurally forbids path separators ('/' and, on Windows, '\'), traversal
// segments (".", ".."), whitespace and shell metacharacters.
var taskNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// windowsReservedNameRe matches Windows reserved device names (CON, PRN, AUX,
// NUL, COM1-9, LPT1-9), including the classic "CON.foo" extension form that
// Windows still treats as the device. A task named "con" would otherwise make
// the daemon open the NUL/console device instead of a real log file on
// Windows.
var windowsReservedNameRe = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$`)

// ValidateTaskName reports whether name is usable as a task identifier.
//
// The name flows into filepath.Join for log files (<name>.log under LogsDir)
// and cloned repositories (<name> under ReposDir), so an unvalidated name such
// as "../evil" would let a task escape ~/.pyrunner/logs, and a later remove
// could delete a directory outside ~/.pyrunner/repos. This check is enforced
// on every write path: the CLI (add) and the daemon's HTTP add endpoint.
func ValidateTaskName(name string) error {
	if name == "" {
		return fmt.Errorf("task name cannot be empty")
	}
	if len(name) > maxTaskNameLen {
		return fmt.Errorf("task name %q is too long (max %d characters)", name, maxTaskNameLen)
	}
	if !taskNameRe.MatchString(name) || strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".") {
		return fmt.Errorf("task name %q must start with a letter or digit and contain only letters, digits, '_', '-' or '.' (not at the start/end)", name)
	}
	if windowsReservedNameRe.MatchString(name) {
		return fmt.Errorf("task name %q is reserved on Windows; choose a different name", name)
	}
	return nil
}
