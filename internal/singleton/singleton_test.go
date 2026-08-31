package singleton

import (
"os"
"os/exec"
"path/filepath"
"testing"

"github.com/stretchr/testify/assert"
"github.com/stretchr/testify/require"
)

// lockPathEnv is the env var used to pass the lock path to the helper
// subprocess. Env vars avoid Go test flag-parsing quirks with "--".
const lockPathEnv = "SINGLETON_TEST_LOCK_PATH"

// TestAcquireAndRelease verifies basic acquire then release works. The
// platform-specific PID-file check lives in singleton_test_unix.go, because
// the Windows implementation uses a named mutex and intentionally does not
// create a lock file.
func TestAcquireAndRelease(t *testing.T) {
dir := t.TempDir()
lockPath := filepath.Join(dir, "daemon.lock")

lock, err := Acquire(lockPath)
require.NoError(t, err, "first acquire should succeed")

lock.Release()

// Release is idempotent.
lock.Release()
lock.Release()
}

// TestSecondProcessBlocked verifies mutual exclusion across processes: a
// child process must fail to acquire while we hold the lock.
func TestSecondProcessBlocked(t *testing.T) {
dir := t.TempDir()
lockPath := filepath.Join(dir, "daemon.lock")

lock, err := Acquire(lockPath)
require.NoError(t, err, "first acquire should succeed")
defer lock.Release()

out, err := runHelper(lockPath)
assert.Error(t, err, "child process should have failed to acquire the lock")
assert.Contains(t, string(out), "already running", "expected 'already running' in child output")
}

// TestAcquireAfterRelease verifies that after releasing, another process can
// acquire the lock (no stale-lock problem with flock).
func TestAcquireAfterRelease(t *testing.T) {
dir := t.TempDir()
lockPath := filepath.Join(dir, "daemon.lock")

lock, err := Acquire(lockPath)
require.NoError(t, err, "first acquire should succeed")
lock.Release()

out, err := runHelper(lockPath)
require.NoError(t, err, "child should acquire after release, out=%s", out)
}

// runHelper spawns a subprocess that tries to Acquire(lockPath). It returns
// the combined output and the process error.
func runHelper(lockPath string) ([]byte, error) {
cmd := exec.Command(os.Args[0], "-test.run", "^TestHelperAcquire$")
cmd.Env = append(os.Environ(), lockPathEnv+"="+lockPath)
return cmd.CombinedOutput()
}

// TestHelperAcquire is a test helper run as a subprocess. It attempts to
// acquire the lock given via the SINGLETON_TEST_LOCK_PATH env var. It exits 0
// on success and non-zero on failure (printing the error).
func TestHelperAcquire(t *testing.T) {
lockPath := os.Getenv(lockPathEnv)
if lockPath == "" {
t.Skip("helper invoked without lock path (only run as a subprocess)")
}

lock, err := Acquire(lockPath)
if err != nil {
// Print to stdout so the parent's CombinedOutput captures the reason.
// t.Log may be swallowed when os.Exit short-circuits the test.
println(err.Error())
os.Exit(1)
}
lock.Release()
os.Exit(0)
}
