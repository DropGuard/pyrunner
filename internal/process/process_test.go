package process_test

import (
	"io"
	"path/filepath"
	"testing"

	"github.com/DropGuard/pyrunner/internal/process"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSpawnAndOutput(t *testing.T) {
	// Use the static python fixture from testdata
	scriptPath, err := filepath.Abs(filepath.Join("testdata", "test_output.py"))
	require.NoError(t, err)

	// Ensure uv is in PATH or this test might fail in minimal environments
	// But since this project wraps uv, uv should be available.
	job, err := process.Spawn(scriptPath)
	require.NoError(t, err, "Spawn should not fail")
	require.NotNil(t, job)

	// Read stdout
	stdoutBytes, err := io.ReadAll(job.Stdout)
	require.NoError(t, err)
	assert.Contains(t, string(stdoutBytes), "hello stdout")

	// Read stderr
	stderrBytes, err := io.ReadAll(job.Stderr)
	require.NoError(t, err)
	assert.Contains(t, string(stderrBytes), "hello stderr")

	// Wait for process to exit
	exitCode, err := job.Wait()
	require.NoError(t, err)
	assert.Equal(t, 0, exitCode)
}
