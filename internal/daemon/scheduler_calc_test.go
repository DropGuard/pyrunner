package daemon

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCalculateNextRunBasic verifies simple daily cron produces the expected
// next run time.
func TestCalculateNextRunBasic(t *testing.T) {
	// Cron "0 12 * * *" = daily at 12:00.
	base := time.Date(2026, 8, 17, 10, 0, 0, 0, time.Local)
	next, err := CalculateNextRun("0 12 * * *", base)
	require.NoError(t, err)
	want := time.Date(2026, 8, 17, 12, 0, 0, 0, time.Local)
	assert.Equal(t, want, next)
}

// TestCalculateNextRunPastTime verifies that CalculateNextRun always returns
// the next FUTURE occurrence after baseTime — it never backfills to an
// already-passed slot today.
//
// NOTE on compensation semantics: this is distinct from PyRunner's catch-up
// behavior. Catch-up ("missed jobs") happens in the daemon entrypoint
// (cmd/pyrunnerd/main.go): when a job's NextRunTime is already in the past at
// startup, the job is run once to make up for the missed slot, and only then
// is NextRunTime advanced via CalculateNextRun. So CalculateNextRun itself is
// purely a "what comes next" computation, not the catch-up mechanism.
func TestCalculateNextRunPastTime(t *testing.T) {
	// It's 15:00, daily cron at 12:00 already passed today.
	base := time.Date(2026, 8, 17, 15, 0, 0, 0, time.Local)
	next, err := CalculateNextRun("0 12 * * *", base)
	require.NoError(t, err)
	// Next must be tomorrow at 12:00 (the next future occurrence).
	want := time.Date(2026, 8, 18, 12, 0, 0, 0, time.Local)
	assert.Equal(t, want, next)
}

// TestCalculateNextRunWeekly verifies a weekly cron.
func TestCalculateNextRunWeekly(t *testing.T) {
	// "0 9 * * 1" = Mondays at 09:00. 2026-08-17 is a Monday.
	base := time.Date(2026, 8, 17, 8, 0, 0, 0, time.Local) // Monday 08:00
	next, err := CalculateNextRun("0 9 * * 1", base)
	require.NoError(t, err)
	want := time.Date(2026, 8, 17, 9, 0, 0, 0, time.Local)
	assert.Equal(t, want, next)
}

// TestCalculateNextRunInvalid verifies an invalid cron returns an error.
func TestCalculateNextRunInvalid(t *testing.T) {
	_, err := CalculateNextRun("not a cron", time.Now())
	assert.Error(t, err, "expected error for invalid cron")
}

// TestCalculateNextRunWildcard verifies "* * * * *" runs every minute.
func TestCalculateNextRunWildcard(t *testing.T) {
	base := time.Date(2026, 8, 17, 10, 30, 15, 0, time.Local)
	next, err := CalculateNextRun("* * * * *", base)
	require.NoError(t, err)
	// Next minute boundary.
	want := time.Date(2026, 8, 17, 10, 31, 0, 0, time.Local)
	assert.Equal(t, want, next)
}
