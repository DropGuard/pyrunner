// Package singleton provides a strict single-instance lock for background
// daemons. The concrete locking mechanism is platform-specific:
//
//   - Unix (linux/darwin/...): flock(2) advisory file lock. The kernel
//     releases the lock automatically when the owning process exits, even on
//     a crash, so there is no stale-lock cleanup or PID-reuse ambiguity.
//   - Windows: a named mutex (CreateMutex). The kernel also releases it when
//     the owning process exits, giving the same robustness.
//
// This file declares the shared API; the per-platform implementations live in
// singleton_unix.go and singleton_windows.go.
package singleton
