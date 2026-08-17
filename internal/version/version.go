// Package version centralizes the PyRunner version string.
//
// The version is set at build time via -ldflags "-X
// github.com/DropGuard/pyrunner/internal/version.Version=vX.Y.Z". When built
// without ldflags (e.g. local dev builds) it falls back to a dev default.
package version

// Version is the semantic version of the PyRunner binaries. Overridden at
// build time by the Makefile / CI when releasing (see make VERSION=...).
var Version = "0.2.0"

// String returns the current version string.
func String() string {
	return Version
}
