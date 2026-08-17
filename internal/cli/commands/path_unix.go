//go:build !windows

package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// registerOnPath exposes the CLI binary on the user's PATH by creating a
// symlink in the first user-writable directory that is already on PATH.
// Returns the path where the symlink was created, or an error if no suitable
// directory exists. Uninstall uses the returned path to clean up.
func registerOnPath(binPath string) (string, error) {
	target := filepath.Base(binPath)

	// Candidate directories: prefer a user-local bin dir that's on PATH.
	// Home-relative dirs are resolved so ~/.local/bin works when $HOME is set.
	var candidates []string
	pathDirs := filepath.SplitList(os.Getenv("PATH"))
	for _, d := range pathDirs {
		if strings.Contains(d, "~") {
			if home, err := os.UserHomeDir(); err == nil {
				d = strings.Replace(d, "~", home, 1)
			}
		}
		abs, err := filepath.Abs(d)
		if err == nil {
			candidates = append(candidates, abs)
		}
	}

	// Prefer directories that already contain pyrunner or are clearly user bins.
	ordered := candidates
	for _, d := range candidates {
		base := filepath.Base(d)
		if base == ".local" || base == "bin" || strings.Contains(d, ".local/bin") {
			ordered = append([]string{d}, ordered...)
		}
	}

	for _, dir := range ordered {
		if !isUserWritableDir(dir) {
			continue
		}
		linkPath := filepath.Join(dir, target)
		if err := os.Symlink(binPath, linkPath); err != nil {
			// May already exist pointing elsewhere; try to replace it.
			if os.Remove(linkPath) == nil {
				if err := os.Symlink(binPath, linkPath); err == nil {
					return linkPath, nil
				}
			}
			continue
		}
		return linkPath, nil
	}

	return "", fmt.Errorf("no writable directory on PATH found — add %s to your PATH manually (e.g. ~/.local/bin)", filepath.Dir(binPath))
}

// unregisterFromPath removes the symlink created by registerOnPath.
func unregisterFromPath(binPath string) {
	target := filepath.Base(binPath)
	pathDirs := filepath.SplitList(os.Getenv("PATH"))
	for _, d := range pathDirs {
		if strings.Contains(d, "~") {
			if home, err := os.UserHomeDir(); err == nil {
				d = strings.Replace(d, "~", home, 1)
			}
		}
		linkPath := filepath.Join(d, target)
		if fi, err := os.Lstat(linkPath); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			if resolved, err := filepath.EvalSymlinks(linkPath); err == nil && resolved == binPath {
				os.Remove(linkPath)
			}
		}
	}
}

func isUserWritableDir(dir string) bool {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	f, err := os.CreateTemp(dir, ".pyrunner-write-test-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}
