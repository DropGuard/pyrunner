//go:build !windows

// Unix implementation: flock(2) advisory file lock. The kernel releases the
// lock automatically when the owning process exits (even on a crash), so
// there is no stale-lock cleanup or PID-reuse ambiguity.
package singleton

import (
	"fmt"
	"os"
	"strconv"
	"syscall"
)

// Lock is an acquired single-instance lock backed by a flock'd file.
type Lock struct {
	f *os.File
}

// Acquire takes a non-blocking exclusive flock on lockPath. If another
// process already holds the lock, it returns an error (the caller is a
// duplicate). The current PID is written to the file for diagnostics, but the
// lock itself is entirely managed by the kernel via flock.
//
// The returned Release closes the file, which releases the flock. The lock
// file itself is left in place (harmless and consistent with flock idiom).
func Acquire(lockPath string) (*Lock, error) {
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open lock file %s: %w", lockPath, err)
	}

	// Non-blocking exclusive lock. Fails immediately if another process holds
	// the lock, without waiting.
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if err == syscall.EWOULDBLOCK || err == syscall.EAGAIN {
			return nil, fmt.Errorf("already running (lock %s is held by another process)", lockPath)
		}
		return nil, fmt.Errorf("flock %s: %w", lockPath, err)
	}

	// Truncate and write our PID for diagnostics / tooling.
	f.Truncate(0)
	f.Seek(0, 0)
	f.WriteString(strconv.Itoa(os.Getpid()))
	f.Sync()

	return &Lock{f: f}, nil
}

// Release releases the lock. Closing the file releases the flock. Safe to
// call multiple times.
func (l *Lock) Release() {
	if l == nil || l.f == nil {
		return
	}
	syscall.Flock(int(l.f.Fd()), syscall.LOCK_UN)
	l.f.Close()
	l.f = nil
}
