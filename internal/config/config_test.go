package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewFromEnvDefault verifies the default config when no env vars are set
// (baseDir falls back to ~/.pyrunner).
func TestNewFromEnvDefault(t *testing.T) {
	cfg := newFromEnv(func(string) string { return "" })

	home, _ := os.UserHomeDir()
	wantBase := filepath.Join(home, ".pyrunner")
	assert.Equal(t, wantBase, cfg.PyrunnerDir)
	assert.Equal(t, filepath.Join(wantBase, "jobs.sqlite"), cfg.DBPath)
	assert.Equal(t, filepath.Join(wantBase, "daemon.sock"), cfg.DaemonIpcPath)
	assert.Equal(t, DefaultJobTimeout, cfg.DefaultTimeout)
}

// TestNewFromEnvCustom verifies PYRUNNER_DIR overrides the base dir.
func TestNewFromEnvCustom(t *testing.T) {
	cfg := newFromEnv(func(k string) string {
		if k == "PYRUNNER_DIR" {
			return "/custom/dir"
		}
		return ""
	})

	assert.Equal(t, "/custom/dir", cfg.PyrunnerDir)
	assert.Equal(t, filepath.Join("/custom/dir", "jobs.sqlite"), cfg.DBPath)
}

// TestNewFromEnvDBOverride verifies PYRUNNER_DB_PATH wins over everything.
func TestNewFromEnvDBOverride(t *testing.T) {
	cfg := newFromEnv(func(k string) string {
		if k == "PYRUNNER_DB_PATH" {
			return "/tmp/special.db"
		}
		return ""
	})
	assert.Equal(t, "/tmp/special.db", cfg.DBPath)
}

// TestEnsureEnv verifies EnsureEnv creates the directory tree.
func TestEnsureEnv(t *testing.T) {
	base := t.TempDir()
	cfg := ForTest(base)

	require.NoError(t, cfg.EnsureEnv())
	for _, dir := range []string{cfg.PyrunnerDir, cfg.BinDir, cfg.LogsDir, cfg.ReposDir} {
		info, err := os.Stat(dir)
		require.NoError(t, err, "EnsureEnv should create %s", dir)
		assert.True(t, info.IsDir(), "%s should be a directory", dir)
	}
}

// TestForTestRoots verifies ForTest roots everything under baseDir and uses a
// file-backed DB (not :memory:).
func TestForTestRoots(t *testing.T) {
	base := t.TempDir()
	cfg := ForTest(base)

	assert.Equal(t, base, cfg.PyrunnerDir)
	assert.Equal(t, filepath.Join(base, "jobs.sqlite"), cfg.DBPath)
	assert.Equal(t, filepath.Join(base, "bin"), cfg.BinDir)
}
