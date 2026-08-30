//go:build !windows

package commands

import "syscall"

func getHideWindowAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
