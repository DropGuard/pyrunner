package commands

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var lookPath = exec.LookPath

// Color styles
var (
	successStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("10")) // green
	errorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))  // red
	warnStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("11")) // yellow
	infoStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("14")) // cyan
	boldStyle    = lipgloss.NewStyle().Bold(true)
)

func printSuccess(msg string) {
	fmt.Println(successStyle.Render("[OK] " + msg))
}

func printWarn(msg string) {
	fmt.Println(warnStyle.Render("[WARN] " + msg))
}

func printInfo(msg string) {
	fmt.Println(infoStyle.Render("[INFO] " + msg))
}

func formatStatus(status string) string {
	switch status {
	case "running":
		return warnStyle.Render("● running")
	case "failed":
		return errorStyle.Render("● failed")
	case "missing_script":
		return errorStyle.Render("● missing")
	default:
		return successStyle.Render("● idle")
	}
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s[:width]
	}
	return s + strings.Repeat(" ", width-len(s))
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o755)
}
