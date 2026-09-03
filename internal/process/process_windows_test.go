//go:build windows

package process

import (
	"os/exec"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSetProcessGroupNoop verifies setProcessGroup is a no-op on Windows
// (taskkill /T handles the tree), so it must not panic or set attributes.
func TestSetProcessGroupNoop(t *testing.T) {
	cmd := &exec.Cmd{}
	assert.NotPanics(t, func() { setProcessGroup(cmd) })
	assert.Nil(t, cmd.SysProcAttr, "setProcessGroup should not touch SysProcAttr on Windows")
}

// TestSetHideWindow verifies setHideWindow marks the child for creation
// without a visible console window (STARTF_USESHOWWINDOW + SW_HIDE, which Go
// maps from SysProcAttr.HideWindow). A scheduled script that allocates a fresh
// console — the daemon is often started detached with no console to inherit —
// would otherwise pop a black cmd window on the user's desktop.
func TestSetHideWindow(t *testing.T) {
	cmd := &exec.Cmd{}
	setHideWindow(cmd)

	require.NotNil(t, cmd.SysProcAttr, "SysProcAttr should be set")
	assert.True(t, cmd.SysProcAttr.HideWindow, "HideWindow should be true so no console window appears")
}

// TestSetHideWindowPreservesExistingAttr verifies a pre-existing SysProcAttr
// is not clobbered: process.Spawn may set other fields on the attribute
// struct before setHideWindow is called.
func TestSetHideWindowPreservesExistingAttr(t *testing.T) {
	cmd := &exec.Cmd{}
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW

	setHideWindow(cmd)

	assert.True(t, cmd.SysProcAttr.HideWindow, "HideWindow should be set without resetting the struct")
	assert.Equal(t, uint32(0x08000000), cmd.SysProcAttr.CreationFlags, "existing flags must be preserved")
}
