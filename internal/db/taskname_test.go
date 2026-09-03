package db

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateTaskNameAccepts(t *testing.T) {
	valid := []string{
		"a",
		"task1",
		"my_task",
		"task.name",
		"TASK-1",
		"MyTask.2024",
		"dropguard/moxing_checkin", // no — wait, this must NOT be valid
	}
	_ = valid
	cases := []string{
		"a", "task1", "my_task", "task.name", "TASK-1", "MyTask.2024",
		"a1", "period.mid.dot", "dash-sep", "under_score",
	}
	for _, name := range cases {
		assert.NoError(t, ValidateTaskName(name), "ValidateTaskName(%q)", name)
	}
}

func TestValidateTaskNameRejects(t *testing.T) {
	cases := []string{
		"",        // empty
		".",       // traversal
		"..",      // traversal
		".hidden", // leading dot
		"task.",   // trailing dot (Windows-invalid file name)
		"../evil", // traversal
		"a/b",     // path separator (unix)
		`a\b`,     // path separator (windows)
		"a b",     // whitespace
		"a:b",     // drive separator / reserved char on Windows
		"con",     // Windows reserved device
		"CON",     // case-insensitive
		"con.txt", // classic device form
		"nul",     // Windows reserved device
		"lpt1",    // Windows reserved device
		"com9",    // Windows reserved device
		"com10",   // NOT reserved (COM1-9 only) but still valid charset... it passes
		"-lead",   // must start with letter/digit
		"_lead",   // must start with letter/digit
		"中文",      // non-ASCII not allowed
		"emoji🙂",  // non-ASCII not allowed
		"has*spl", // shell metacharacter
		"has?spl", // glob metacharacter
	}
	for _, name := range cases {
		// com10 is actually a legal task name; exclude it from the reject list.
		if name == "com10" {
			continue
		}
		assert.Error(t, ValidateTaskName(name), "ValidateTaskName(%q) should fail", name)
	}
}

func TestValidateTaskNameAllowsCOM10(t *testing.T) {
	assert.NoError(t, ValidateTaskName("com10"))
	assert.NoError(t, ValidateTaskName("lpt10"))
}

func TestValidateTaskNameLength(t *testing.T) {
	long := strings.Repeat("a", maxTaskNameLen)
	assert.NoError(t, ValidateTaskName(long))

	tooLong := strings.Repeat("a", maxTaskNameLen+1)
	assert.Error(t, ValidateTaskName(tooLong))
}
