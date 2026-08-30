//go:build windows

// Windows implementation: named mutex (CreateMutex). A named mutex is
// process-global; a second process creating a mutex with the same name gets
// ERROR_ALREADY_EXISTS, which we use to enforce single-instance. The kernel
// releases the mutex automatically when the owning process exits, so there is
// no stale-lock cleanup (same robustness as flock on Unix).
//
// A PID file is also written to lockPath for diagnostics and tooling parity
// with the Unix flock-based implementation. The mutex is the authoritative
// lock; the file is informational only.
package singleton

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/windows"
)

// Lock is an acquired single-instance lock backed by a named mutex, with an
// informational PID file alongside it.
type Lock struct {
	handle windows.Handle
	f      *os.File
}

// mutexNameFromPath derives a stable global mutex name from the lock path so
// all instances of the daemon agree on the same name. Windows mutex names must
// not contain backslashes, so path separators are mapped to underscores.
func mutexNameFromPath(lockPath string) string {
	name := strings.NewReplacer("\\", "_", "/", "_", ":", "_", ".", "_").Replace(lockPath)
	return "Local\\pyrunner_" + name
}

// Acquire creates a named mutex with bInitialOwner=true. When the mutex
// already exists, CreateMutex still succeeds but returns the
// ERROR_ALREADY_EXISTS error — the caller is a duplicate. The kernel manages
// ownership, so there is no stale state. The PID is written to lockPath for
// diagnostics.
//
// The returned Release closes the handle, which releases the mutex.
func Acquire(lockPath string) (*Lock, error) {
	name := mutexNameFromPath(lockPath)

	// bInitialOwner=true: if we create the mutex, we own it immediately.
	h, err := windows.CreateMutex(nil, true, windows.StringToUTF16Ptr(name))
	if err == windows.ERROR_ALREADY_EXISTS {
		// The mutex already exists and we were handed a handle, but another
		// process created it and owns it. Release our handle and bail.
		windows.CloseHandle(h)
		return nil, fmt.Errorf("already running (mutex %q is held by another process)", name)
	}
	if err != nil {
		return nil, fmt.Errorf("CreateMutex %s: %w", name, err)
	}

	// Write PID to lockPath for diagnostics. Errors here are non-fatal: the
	// mutex is the actual lock; the file is just informational.
	f, ferr := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o644)
	if ferr == nil {
		_, _ = f.WriteString(strconv.Itoa(os.Getpid()))
		_ = f.Sync()
	}

	return &Lock{handle: h, f: f}, nil
}

// Release closes the mutex handle and PID file, releasing the lock. Safe to
// call multiple times.
func (l *Lock) Release() {
	if l == nil {
		return
	}
	if l.handle != 0 {
		windows.ReleaseMutex(l.handle)
		windows.CloseHandle(l.handle)
		l.handle = 0
	}
	if l.f != nil {
		l.f.Close()
		l.f = nil
	}
}
