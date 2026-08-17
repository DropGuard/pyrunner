//go:build windows

// Windows implementation: named mutex (CreateMutex). A named mutex is
// process-global; a second process creating a mutex with the same name gets
// ERROR_ALREADY_EXISTS, which we use to enforce single-instance. The kernel
// releases the mutex automatically when the owning process exits, so there is
// no stale-lock cleanup (same robustness as flock on Unix).
package singleton

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
)

// Lock is an acquired single-instance lock backed by a named mutex.
type Lock struct {
	handle windows.Handle
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
// ownership, so there is no stale state.
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

	return &Lock{handle: h}, nil
}

// Release closes the mutex handle, releasing the lock. Safe to call multiple
// times.
func (l *Lock) Release() {
	if l == nil || l.handle == 0 {
		return
	}
	windows.ReleaseMutex(l.handle)
	windows.CloseHandle(l.handle)
	l.handle = 0
}
