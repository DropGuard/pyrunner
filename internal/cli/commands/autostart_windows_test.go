//go:build windows

package commands

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows/registry"
)

// testKeyPath is a throwaway HKCU key used by these tests. It never touches
// the real Run key, so the tests are safe to run on any Windows machine or CI
// runner.
const testKeyPath = `Software\PyRunnerTest\AutoStart`

// TestWriteAutoStart writes a value and asserts it is readable back.
func TestWriteAutoStart(t *testing.T) {
	// Clean up any leftovers from a previous failed run.
	deleteTestKey(t)

	err := writeAutoStart(registry.CURRENT_USER, testKeyPath, "PyRunner", `C:\pyrunner\pyrunner.exe start`)
	require.NoError(t, err)
	defer deleteTestKey(t)

	// Read it back and assert the value.
	k, err := registry.OpenKey(registry.CURRENT_USER, testKeyPath, registry.QUERY_VALUE)
	require.NoError(t, err)
	defer k.Close()

	val, _, err := k.GetStringValue("PyRunner")
	require.NoError(t, err)
	assert.Equal(t, `C:\pyrunner\pyrunner.exe start`, val)
}

// TestDeleteAutoStart writes then deletes, asserting removal.
func TestDeleteAutoStart(t *testing.T) {
	deleteTestKey(t)

	require.NoError(t, writeAutoStart(registry.CURRENT_USER, testKeyPath, "PyRunner", "cmd"))
	require.NoError(t, deleteAutoStart(registry.CURRENT_USER, testKeyPath, "PyRunner"))

	// Value should be gone.
	k, err := registry.OpenKey(registry.CURRENT_USER, testKeyPath, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()
		_, _, gerr := k.GetStringValue("PyRunner")
		assert.Error(t, gerr, "value should have been deleted")
	}
}

// TestDeleteAutoStartNoKey verifies deleting from a non-existent key is a
// harmless no-op.
func TestDeleteAutoStartNoKey(t *testing.T) {
	deleteTestKey(t) // ensure absent
	assert.NoError(t, deleteAutoStart(registry.CURRENT_USER, testKeyPath, "PyRunner"), "deleting from missing key should be nil")
}

// deleteTestKey removes the entire test key tree if it exists.
func deleteTestKey(t *testing.T) {
	t.Helper()
	// registry.DeleteKey removes a subkey; we need to remove the value first,
	// then the key. Simplest: delete the key (requires it to be empty).
	_ = registry.DeleteKey(registry.CURRENT_USER, testKeyPath)
}
