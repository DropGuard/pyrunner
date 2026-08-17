//go:build !windows

package commands

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestExpandHome verifies expandHome resolves ~ to an absolute path, which is
// required by XDG autostart's Exec key (desktop environments do not expand ~).
func TestExpandHome(t *testing.T) {
	home, _ := os.UserHomeDir()

	cases := []struct {
		in   string
		want string
	}{
		{"~", home},
		{"~/bin/pyrunner", filepath.Join(home, "bin", "pyrunner")},
		{"/abs/path", "/abs/path"},
		{"rel/path", "rel/path"},
		{home + "/x", home + "/x"}, // already absolute
		{"", ""},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, expandHome(c.in), "expandHome(%q)", c.in)
	}
}

// TestRegisterAutoStartWritesAbsolutePath verifies the .desktop Exec line
// contains an absolute path (no ~), so it works on real desktop environments.
func TestRegisterAutoStartWritesAbsolutePath(t *testing.T) {
	// Point HOME at a temp dir so we don't touch the real autostart config.
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	require.NoError(t, registerAutoStart("~/bin/pyrunner"))

	desktopPath := filepath.Join(tmpHome, ".config", "autostart", "pyrunner.desktop")
	data, err := os.ReadFile(desktopPath)
	require.NoError(t, err)

	// The Exec line must be an absolute path, never containing "~".
	assert.True(t, containsAbsExec(string(data)), "Exec should be absolute path, got:\n%s", string(data))

	// Cleanup
	_ = unregisterAutoStart()
}

func containsAbsExec(content string) bool {
	for _, line := range splitLines(content) {
		// "Exec=" is 5 characters; compare the full prefix.
		if len(line) >= 5 && line[:5] == "Exec=" {
			val := line[5:]
			return len(val) > 0 && (val[0] == '/' || val[0] == '$')
		}
	}
	return false
}

func splitLines(s string) []string {
	var out []string
	cur := ""
	for _, c := range s {
		if c == '\n' {
			out = append(out, cur)
			cur = ""
		} else {
			cur += string(c)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
