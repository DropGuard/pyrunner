//go:build darwin

package commands

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRegisterAutoStartWritesPlist verifies the LaunchAgent plist contains
// the expected Label, absolute binary path, and RunAtLoad=true. We do not
// invoke `launchctl load` for real — that's verified manually on a macOS
// machine. This mirrors TestRegisterAutoStartWritesAbsolutePath on Linux.
func TestRegisterAutoStartWritesPlist(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	// launchctl is real on macOS CI runners (darwin-latest); skip rather than
	// actually loading the agent so the test stays hermetic.
	prev := lookPath
	lookPath = func(string) (string, error) { return "/bin/launchctl", nil }
	defer func() { lookPath = prev }()

	binaryPath := "/usr/local/bin/pyrunner"
	require.NoError(t, registerAutoStart(binaryPath))
	t.Cleanup(func() { _ = unregisterAutoStart() })

	plistPath := filepath.Join(tmpHome, "Library", "LaunchAgents", launchAgentLabel+".plist")
	data, err := os.ReadFile(plistPath)
	require.NoError(t, err)
	content := string(data)

	assert.Contains(t, content, "<string>"+launchAgentLabel+"</string>", "Label should be %s", launchAgentLabel)
	assert.Contains(t, content, "<string>"+binaryPath+"</string>", "ProgramArguments should contain absolute binary path")
	assert.Contains(t, content, "<string>start</string>", "ProgramArguments should include 'start'")
	assert.Contains(t, content, "<string>--hidden</string>", "ProgramArguments should include '--hidden'")
	assert.Contains(t, content, "<key>RunAtLoad</key>\n    <true/>", "RunAtLoad must be true")

	// KeepAlive must NOT be present — we deliberately omit it so a crashed
	// daemon stays down (visible bug) instead of being silently restarted.
	assert.NotContains(t, content, "KeepAlive", "KeepAlive should be omitted (user-level, crash-visible-by-design)")
}

// TestRegisterAutoStartFailsWithoutLaunchctl verifies fail-fast when launchctl
// is missing from PATH. The plist must not be left behind on this failure
// path either — but actually we DO leave it (see comment in
// registerAutoStart), so what we assert is the *error* and that the caller is
// told the agent wasn't loaded. (Whether the plist remains is a manual
// concern; the test asserts the error path is loud.)
func TestRegisterAutoStartFailsWithoutLaunchctl(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	prev := lookPath
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { lookPath = prev }()

	err := registerAutoStart("/usr/local/bin/pyrunner")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "launchctl")
}

// TestUnregisterAutoStartRemovesPlist verifies the plist is deleted even if
// launchctl unload fails — the user's intent is "delete the plist", and an
// unloaded / never-loaded agent still leaves a valid plist to remove.
func TestUnregisterAutoStartRemovesPlist(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	plistPath := filepath.Join(tmpHome, "Library", "LaunchAgents", launchAgentLabel+".plist")
	require.NoError(t, os.MkdirAll(filepath.Dir(plistPath), 0o755))
	require.NoError(t, os.WriteFile(plistPath, []byte("<plist/>"), 0o644))

	// launchctl is absent on this test host (or we'd actually unload) — but
	// that doesn't matter: unregister must still delete the file.
	prev := lookPath
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { lookPath = prev }()

	require.NoError(t, unregisterAutoStart())

	_, err := os.Stat(plistPath)
	assert.True(t, os.IsNotExist(err), "plist should be removed; stat err = %v", err)
}

// TestUnregisterAutoStartNoPlist verifies uninstall on a clean machine (no
// plist) is a successful no-op.
func TestUnregisterAutoStartNoPlist(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	assert.NoError(t, unregisterAutoStart(), "uninstalling with no plist present should not error")
}

// TestLaunchAgentPath sanity-checks the path computation matches the macOS
// LaunchAgents convention.
func TestLaunchAgentPath(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	p, err := launchAgentPath()
	require.NoError(t, err)
	want := filepath.Join(tmpHome, "Library", "LaunchAgents", "com.dropguard.pyrunner.plist")
	assert.Equal(t, want, p)
	assert.True(t, strings.HasPrefix(p, tmpHome), "plist must live under HOME")
}
