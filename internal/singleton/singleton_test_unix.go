//go:build !windows

package singleton

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAcquireAndReleaseWritesPIDFile verifies the Unix (flock-based)
// implementation writes a lock file containing our PID. The Windows
// implementation uses a named mutex and intentionally does not create a
// lock file, so this check only runs on non-Windows platforms.
func TestAcquireAndReleaseWritesPIDFile(t *testing.T) {
	dir := t.TempDir()
	lockPath := filepath.Join(dir, "daemon.lock")

	lock, err := Acquire(lockPath)
	require.NoError(t, err, "first acquire should succeed")
	defer lock.Release()

	data, err := os.ReadFile(lockPath)
	require.NoError(t, err, "lock file should exist")
	assert.NotEmpty(t, strings.TrimSpace(string(data)), "lock file should contain our PID")
}
