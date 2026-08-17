//go:build windows

package commands

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestRegisterOnPathWindows verifies registerOnPath returns the bin directory
// (it adds it to PATH via setx; the function returns binDir on success or as a
// best-effort fallback when setx is unavailable).
func TestRegisterOnPathWindows(t *testing.T) {
	binDir := t.TempDir()
	binPath := filepath.Join(binDir, "pyrunner.exe")

	dir, err := registerOnPath(binPath)
	assert.NoError(t, err, "registerOnPath should not error")
	assert.Equal(t, binDir, dir, "should return the directory containing the binary")
}

// TestUnregisterFromPathWindows verifies unregisterFromPath runs without
// panicking, whether the exe exists or not (it is best-effort).
func TestUnregisterFromPathWindows(t *testing.T) {
	binDir := t.TempDir()

	// Case 1: the exe exists — the function removes it without erroring.
	exe := filepath.Join(binDir, "pyrunner.exe")
	requireWrite := os.WriteFile(exe, []byte("MZ..."), 0o644)
	if requireWrite == nil {
		assert.NotPanics(t, func() { unregisterFromPath(exe) })
	}

	// Case 2: the exe does not exist — still no panic.
	assert.NotPanics(t, func() { unregisterFromPath(filepath.Join(binDir, "missing.exe")) })
}
