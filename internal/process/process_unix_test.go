//go:build !windows

package process

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSetProcessGroup verifies setProcessGroup puts the child in its own
// process group (Setpgid), which is what lets KillTree(-pid) kill the whole
// tree.
func TestSetProcessGroup(t *testing.T) {
	cmd := &exec.Cmd{}
	setProcessGroup(cmd)

	require.NotNil(t, cmd.SysProcAttr, "SysProcAttr should be set")
	assert.True(t, cmd.SysProcAttr.Setpgid, "Setpgid should be true so the child is its own group leader")
}

// TestSetHideWindowNoop verifies setHideWindow is a no-op on Unix (no window
// concept), so it must not panic or modify the command.
func TestSetHideWindowNoop(t *testing.T) {
	cmd := &exec.Cmd{}
	assert.NotPanics(t, func() { setHideWindow(cmd) })
}

// TestKillTreeMissingProcess verifies KillTree returns an error for a PID that
// does not exist rather than hanging or panicking. A negative PID targets the
// process group; -1 is not a real group, so the kill should fail.
func TestKillTreeMissingProcess(t *testing.T) {
	err := KillTree(-1, true)
	assert.Error(t, err, "killing a non-existent process group should error")
}
