package commands

import "testing"

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
		if got := IsRemoteSource(c.arg); got != c.want {
			t.Errorf("IsRemoteSource(%q) = %v, want %v", c.arg, got, c.want)
		}
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
		if got := RepoNameFromURL(c.arg); got != c.want {
			t.Errorf("RepoNameFromURL(%q) = %q, want %q", c.arg, got, c.want)
		}
	}
}
