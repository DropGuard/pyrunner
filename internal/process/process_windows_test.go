//go:build windows

package process

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestSetProcessGroupNoop verifies setProcessGroup is a no-op on Windows
// (taskkill /T handles the tree), so it must not panic.
func TestSetProcessGroupNoop(t *testing.T) {
	cmd := &exec.Cmd{}
	assert.NotPanics(t, func() { setProcessGroup(cmd) })
}

// TestSetHideWindowNoop verifies setHideWindow does not panic on Windows.
func TestSetHideWindowNoop(t *testing.T) {
	cmd := &exec.Cmd{}
	assert.NotPanics(t, func() { setHideWindow(cmd) })
}
