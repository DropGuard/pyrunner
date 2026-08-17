package e2e_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEndToEndLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping E2E test in short mode")
	}

	// Setup a completely isolated environment
	tmpDir := t.TempDir()
	binDir := filepath.Join(tmpDir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))

	// Find module root
	cmdDir, err := os.Getwd()
	require.NoError(t, err)
	rootDir := filepath.Dir(filepath.Dir(cmdDir)) // from internal/e2e to root

	// Build CLI and Daemon
	cliPath := filepath.Join(binDir, "pyrunner")
	daemonPath := filepath.Join(binDir, "pyrunnerd")
	
	buildCLI := exec.Command("go", "build", "-o", cliPath, "./cmd/pyrunner")
	buildCLI.Dir = rootDir
	outBytes, err := buildCLI.CombinedOutput()
	require.NoError(t, err, "failed to build CLI: %s", outBytes)

	buildDaemon := exec.Command("go", "build", "-o", daemonPath, "./cmd/pyrunnerd")
	buildDaemon.Dir = rootDir
	outBytes, err = buildDaemon.CombinedOutput()
	require.NoError(t, err, "failed to build Daemon: %s", outBytes)

	// Helper to run pyrunner CLI commands
	runCLI := func(args ...string) (string, error) {
		cmd := exec.Command(cliPath, args...)
		cmd.Env = append(os.Environ(), "PYRUNNER_DIR="+tmpDir)
		var outBuf, errBuf bytes.Buffer
		cmd.Stdout = &outBuf
		cmd.Stderr = &errBuf
		err := cmd.Run()
		return outBuf.String() + errBuf.String(), err
	}

	// 1. Ensure daemon is not running
	out, err := runCLI("ls")
	assert.Error(t, err)
	assert.Contains(t, out, "Scheduler daemon is not running")

	// 2. Start daemon
	out, err = runCLI("start")
	require.NoError(t, err)
	assert.Contains(t, out, "Daemon started")

	// Allow daemon a moment to initialize
	time.Sleep(500 * time.Millisecond)

	// 3. Verify daemon is running
	out, err = runCLI("ls")
	require.NoError(t, err)
	assert.NotContains(t, out, "Scheduler daemon is not running")
	assert.Contains(t, out, "No tasks found")

	// 4. Add a dummy job
	scriptPath := filepath.Join(tmpDir, "dummy.py")
	require.NoError(t, os.WriteFile(scriptPath, []byte("print('hello e2e')"), 0644))
	
	out, err = runCLI("add", "dummy", scriptPath, "0 0 * * *")
	require.NoError(t, err, "add command failed: %s", out)
	assert.Contains(t, out, "Task 'dummy' added")

	out, err = runCLI("ls")
	require.NoError(t, err)
	assert.Contains(t, out, "dummy")

	// 5. Stop daemon
	out, err = runCLI("stop")
	require.NoError(t, err)
	assert.Contains(t, out, "Daemon stopped")

	// 6. Verify daemon is fully stopped
	out, err = runCLI("ls")
	assert.Error(t, err)
	assert.Contains(t, out, "Scheduler daemon is not running")
}
