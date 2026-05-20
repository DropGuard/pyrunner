//go:build windows

package commands

import (
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const regKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
const regValueName = "PyRunner"

func registerAutoStart(binaryPath string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, regKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open registry key: %w", err)
	}
	defer k.Close()

	return k.SetStringValue(regValueName, binaryPath)
}

func unregisterAutoStart() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, regKeyPath, registry.SET_VALUE)
	if err != nil {
		return nil // key doesn't exist, nothing to do
	}
	defer k.Close()

	return k.DeleteValue(regValueName)
}
