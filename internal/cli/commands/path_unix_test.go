//go:build !windows

package commands

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestIsUserWritableDirTrue verifies a real, writable directory is accepted.
func TestIsUserWritableDirTrue(t *testing.T) {
	dir := t.TempDir()
	assert.True(t, isUserWritableDir(dir), "an existing writable temp dir should be writable")
}

// TestIsUserWritableDirFalse verifies non-existent and non-dir paths are rejected.
func TestIsUserWritableDirFalse(t *testing.T) {
	assert.False(t, isUserWritableDir(filepath.Join(t.TempDir(), "does-not-exist")), "non-existent dir should not be writable")

	f := filepath.Join(t.TempDir(), "file.txt")
	require.NoError(t, os.WriteFile(f, []byte("x"), 0o644))
	assert.False(t, isUserWritableDir(f), "a regular file is not a writable directory")
}

// TestRegisterOnPathSymlink verifies registerOnPath creates a symlink in a
// writable PATH directory and unregisterFromPath removes it.
func TestRegisterOnPathSymlink(t *testing.T) {
	binDir := t.TempDir()
	binPath := filepath.Join(binDir, "pyrunner")
	require.NoError(t, os.WriteFile(binPath, []byte("#!/bin/sh\necho hi\n"), 0o755))

	// A temp dir on PATH, so registerOnPath will pick it.
	pathDir := t.TempDir()
	t.Setenv("PATH", pathDir)

	link, err := registerOnPath(binPath)
	require.NoError(t, err, "registerOnPath should create a symlink in a writable PATH dir")
	assert.Equal(t, filepath.Join(pathDir, "pyrunner"), link)

	// The symlink should resolve to binPath. Resolve both sides through any
	// symlinks in their parents (notably /var -> /private/var on macOS) so the
	// comparison is independent of which form os.TempDir returns.
	resolved, err := filepath.EvalSymlinks(link)
	require.NoError(t, err)
	want, err := filepath.EvalSymlinks(binPath)
	require.NoError(t, err)
	assert.Equal(t, want, resolved)

	// Uninstall removes it.
	unregisterFromPath(binPath)
	_, err = os.Lstat(link)
	assert.Error(t, err, "symlink should be removed by unregisterFromPath")
}

// TestRegisterOnPathNoWritableDir verifies an error when PATH has no writable
// directory.
func TestRegisterOnPathNoWritableDir(t *testing.T) {
	binPath := filepath.Join(t.TempDir(), "pyrunner")

	// Empty PATH → no candidates → error.
	t.Setenv("PATH", "")
	_, err := registerOnPath(binPath)
	assert.Error(t, err, "no writable PATH dir should return an error")
}
