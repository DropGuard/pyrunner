//go:build !windows

package commands

import "syscall"

func getHideWindowAttr() *syscall.SysProcAttr {
	return nil
}
