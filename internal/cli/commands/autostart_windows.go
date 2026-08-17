//go:build windows

package commands

import (
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const regKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
const regValueName = "PyRunner"

// registerAutoStart registers the binary to run at login by writing the
// Windows Run registry key. It uses the default HKCU Run key.
func registerAutoStart(binaryPath string) error {
	return writeAutoStart(registry.CURRENT_USER, regKeyPath, regValueName, binaryPath)
}

func unregisterAutoStart() error {
	return deleteAutoStart(registry.CURRENT_USER, regKeyPath, regValueName)
}

// writeAutoStart writes valueName under keyPath with the given command. The
// root (usually registry.CURRENT_USER) and keyPath are parameters so tests
// can target a throwaway registry key instead of the real Run key.
func writeAutoStart(root registry.Key, keyPath, valueName, command string) error {
	k, err := registry.OpenKey(root, keyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open registry key: %w", err)
	}
	defer k.Close()
	return k.SetStringValue(valueName, command)
}

// deleteAutoStart removes valueName from keyPath. It is a no-op when the key
// does not exist.
func deleteAutoStart(root registry.Key, keyPath, valueName string) error {
	k, err := registry.OpenKey(root, keyPath, registry.SET_VALUE)
	if err != nil {
		return nil // key doesn't exist, nothing to do
	}
	defer k.Close()
	return k.DeleteValue(valueName)
}
