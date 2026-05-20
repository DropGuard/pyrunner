package daemon

import (
	"sync/atomic"
	"testing"
)

func TestScheduleInvalidExpr(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	err := m.Schedule("bad", "not a cron", func() {})
	if err == nil {
		t.Error("expected error for invalid cron expression")
	}
}

func TestUnschedule(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	m.Schedule("removeme", "* * * * *", func() {})
	if _, ok := m.activeJobs["removeme"]; !ok {
		t.Fatal("job should exist")
	}

	m.Unschedule("removeme")
	if _, ok := m.activeJobs["removeme"]; ok {
		t.Error("job should have been removed")
	}
}

func TestRescheduleReplacesExisting(t *testing.T) {
	m := NewCronJobManager()
	defer m.StopAll()

	var count1, count2 atomic.Int32
	m.Schedule("replace", "* * * * *", func() { count1.Add(1) })
	m.Schedule("replace", "* * * * *", func() { count2.Add(1) })

	if len(m.activeJobs) != 1 {
		t.Errorf("expected 1 active job, got %d", len(m.activeJobs))
	}
}

func TestStopAll(t *testing.T) {
	m := NewCronJobManager()

	m.Schedule("a", "* * * * *", func() {})
	m.Schedule("b", "* * * * *", func() {})

	m.StopAll()

	if len(m.activeJobs) != 0 {
		t.Errorf("expected 0 active jobs, got %d", len(m.activeJobs))
	}
}
