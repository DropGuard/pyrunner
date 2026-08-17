package daemon

import (
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScheduleInvalidExpr(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	err := m.Schedule("bad", "not a cron", func() {})
	assert.Error(t, err, "expected error for invalid cron expression")
}

func TestUnschedule(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	require.NoError(t, m.Schedule("removeme", "* * * * *", func() {}))
	_, ok := m.activeJobs["removeme"]
	require.True(t, ok, "job should exist")

	m.Unschedule("removeme")
	_, ok = m.activeJobs["removeme"]
	assert.False(t, ok, "job should have been removed")
}

func TestRescheduleReplacesExisting(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	var count1, count2 atomic.Int32
	require.NoError(t, m.Schedule("replace", "* * * * *", func() { count1.Add(1) }))
	require.NoError(t, m.Schedule("replace", "* * * * *", func() { count2.Add(1) }))

	assert.Len(t, m.activeJobs, 1, "reschedule should replace, not duplicate")
}

func TestStopAll(t *testing.T) {
	m := NewCronJobManager()

	require.NoError(t, m.Schedule("a", "* * * * *", func() {}))
	require.NoError(t, m.Schedule("b", "* * * * *", func() {}))

	m.StopAll()

	assert.Len(t, m.activeJobs, 0, "all active jobs should be stopped")
}
