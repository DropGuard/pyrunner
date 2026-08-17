package commands

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsRemoteSource(t *testing.T) {
	cases := []struct {
		arg  string
		want bool
	}{
		// URL forms
		{"https://github.com/owner/repo", true},
		{"https://github.com/owner/repo.git", true},
		{"http://github.com/owner/repo", true},
		{"git@github.com:owner/repo.git", true},
		// owner/repo shorthand
		{"owner/repo", true},
		{"owner/repo-name", true},
		{"dropguard/moxing_checkin", true},
		// local paths
		{"./scripts/daily_report.py", false},
		{"/abs/path/to/script.py", false},
		{"scripts/daily_report.py", false}, // repo segment has a dot → treated as a file
		{"foo/bar/baz", false},             // more than two segments
		{"../evil/repo", false},            // traversal rejected by the pattern
		{"main.py", false},
		{"", false},
		{"https://", true}, // prefix match; empty name guarded in add.go
	}
	for _, c := range cases {
		assert.Equal(t, c.want, IsRemoteSource(c.arg), "IsRemoteSource(%q)", c.arg)
	}
}

func TestRepoNameFromURL(t *testing.T) {
	cases := []struct {
		arg  string
		want string
	}{
		{"https://github.com/Owner/Repo.git", "repo"},
		{"https://github.com/Owner/Repo", "repo"},
		{"owner/repo", "repo"},
		{"owner/repo.git", "repo"},
		{"git@github.com:owner/repo.git", "repo"},
		{"dropguard/Moxing_Checkin", "moxing_checkin"},
		{"git@github.com:", ""}, // no repo segment
	}
	for _, c := range cases {
		assert.Equal(t, c.want, RepoNameFromURL(c.arg), "RepoNameFromURL(%q)", c.arg)
	}
}
