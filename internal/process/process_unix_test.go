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

// TestKillTreeMissingProcess verifies KillTree treats an already-gone process
// group as success rather than hanging, panicking, or erroring. The caller's
// intent — that no process in the tree survives — is already satisfied when
// the group does not exist, and kill commands (including daemon shutdown and
// kill-after-timeout) are idempotent: a second kill racing the first must not
// surface a spurious error. We use a clearly bogus PID rather than -1 because
// KillTree passes the negative value straight to kill(-pid, ...) — for -1 the
// target is process group 1 (init), which would be unsafe to signal on any
// host that grants the test permission.
func TestKillTreeMissingProcess(t *testing.T) {
	err := KillTree(99999999, true)
	assert.NoError(t, err, "killing a non-existent process group should succeed (nothing left to kill)")
}
