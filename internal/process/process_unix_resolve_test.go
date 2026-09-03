//go:build !windows

package process

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResolveUVPriority checks the resolution order: explicit env override,
// then PATH lookup, then the per-user ~/.local/bin fallback.
func TestResolveUVPriority(t *testing.T) {
	origLook, origHome, origGetenv := uvLookPath, uvHomeDir, uvGetenv
	t.Cleanup(func() { uvLookPath, uvHomeDir, uvGetenv = origLook, origHome, origGetenv })

	uvLookPath = func(name string) (string, error) {
		assert.Equal(t, "uv", name)
		return "/usr/local/bin/uv", nil
	}
	uvHomeDir = func() (string, error) { return "/home/testuser", nil }

	t.Run("prefers env override over PATH", func(t *testing.T) {
		uvGetenv = func(key string) string {
			if key == "PYRUNNER_UV" {
				return "/opt/custom/uv"
			}
			return ""
		}
		p, err := resolveUVPath()
		require.NoError(t, err)
		assert.Equal(t, "/opt/custom/uv", p)
	})

	t.Run("falls back to PATH when no override", func(t *testing.T) {
		uvGetenv = func(key string) string { return "" }
		p, err := resolveUVPath()
		require.NoError(t, err)
		assert.Equal(t, "/usr/local/bin/uv", p)
	})
}

// TestResolveUVFallsBackToLocalBin verifies the ~/.local/bin fallback when uv
// is not on PATH (the daemon's login-agent PATH is often minimal).
func TestResolveUVFallsBackToLocalBin(t *testing.T) {
	origLook, origHome, origGetenv := uvLookPath, uvHomeDir, uvGetenv
	t.Cleanup(func() { uvLookPath, uvHomeDir, uvGetenv = origLook, origHome, origGetenv })

	uvLookPath = func(string) (string, error) { return "", errors.New("not found") }
	uvGetenv = func(string) string { return "" }
	home := t.TempDir()
	uvHomeDir = func() (string, error) { return home, nil }

	t.Run("missing binary returns error", func(t *testing.T) {
		_, err := resolveUVPath()
		assert.Error(t, err)
	})

	t.Run("existing local bin uv is used", func(t *testing.T) {
		dir := filepath.Join(home, ".local", "bin")
		require.NoError(t, os.MkdirAll(dir, 0o755))
		uvPath := filepath.Join(dir, "uv")
		require.NoError(t, os.WriteFile(uvPath, []byte("#!/bin/sh\n"), 0o755))

		p, err := resolveUVPath()
		require.NoError(t, err)
		assert.Equal(t, uvPath, p)
	})
}
