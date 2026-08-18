package daemon_test

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/DropGuard/pyrunner/internal/daemon"
	"github.com/DropGuard/pyrunner/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockRunner struct {
	mu       sync.Mutex
	executed []*db.Job
	triggers []daemon.TriggerType
}

func (m *mockRunner) ExecuteJob(job *db.Job, trigger daemon.TriggerType) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.executed = append(m.executed, job)
	m.triggers = append(m.triggers, trigger)
}

func (m *mockRunner) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.executed)
}

func setupTestRepo(t *testing.T) *db.Repository {
	tmpDir := t.TempDir()
	database, err := db.Open(filepath.Join(tmpDir, "test.sqlite"))
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return db.NewRepository(database)
}

func TestCalculateNextRun(t *testing.T) {
	baseTime := time.Date(2026, 8, 18, 10, 0, 0, 0, time.Local)

	// Valid cron: daily at 12:00
	next, err := daemon.CalculateNextRun("0 12 * * *", baseTime)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 8, 18, 12, 0, 0, 0, time.Local), next)

	// Invalid cron
	_, err = daemon.CalculateNextRun("invalid cron expr", baseTime)
	assert.Error(t, err)
}

func TestSchedulerTick(t *testing.T) {
	repo := setupTestRepo(t)
	runner := &mockRunner{}
	scheduler := daemon.NewScheduler(repo, runner, time.Second)

	now := time.Date(2026, 8, 18, 12, 0, 0, 0, time.Local)

	// 1. Add a job due right now (next_run_time = 12:00)
	require.NoError(t, repo.Add(db.AddJobRequest{
		Name:       "due_job",
		ScriptPath: "/dummy/path.py",
		Cron:       "0 12 * * *",
	}, now.UnixMilli()))

	// 2. Add a future job (next_run_time = 13:00)
	futureTime := now.Add(1 * time.Hour)
	require.NoError(t, repo.Add(db.AddJobRequest{
		Name:       "future_job",
		ScriptPath: "/dummy/path.py",
		Cron:       "0 13 * * *",
	}, futureTime.UnixMilli()))

	// 3. Tick at 12:00:00 -> Only due_job should be triggered
	triggered := scheduler.Tick(now)
	assert.Equal(t, 1, triggered)

	// Give goroutine a moment to invoke runner
	require.Eventually(t, func() bool {
		return runner.Count() == 1
	}, 500*time.Millisecond, 20*time.Millisecond)

	assert.Equal(t, "due_job", runner.executed[0].Name)
	assert.Equal(t, daemon.TriggerScheduled, runner.triggers[0])
}

func TestSchedulerTimeTravelAndCatchUp(t *testing.T) {
	repo := setupTestRepo(t)
	runner := &mockRunner{}
	scheduler := daemon.NewScheduler(repo, runner, time.Second)

	// Job was scheduled for 12:00
	scheduledTime := time.Date(2026, 8, 18, 12, 0, 0, 0, time.Local)
	require.NoError(t, repo.Add(db.AddJobRequest{
		Name:       "checkin_job",
		ScriptPath: "/dummy/checkin.py",
		Cron:       "0 12 * * *",
	}, scheduledTime.UnixMilli()))

	// Simulate system sleeping from 11:30 to 17:30 (5.5 hours later)
	wakeTime := time.Date(2026, 8, 18, 17, 30, 0, 0, time.Local)

	// Tick at wakeTime -> Should detect that 12:00 <= 17:30 and trigger catch-up
	triggered := scheduler.Tick(wakeTime)
	assert.Equal(t, 1, triggered)

	require.Eventually(t, func() bool {
		return runner.Count() == 1
	}, 500*time.Millisecond, 20*time.Millisecond)

	assert.Equal(t, "checkin_job", runner.executed[0].Name)
}

func TestSchedulerStartStop(t *testing.T) {
	repo := setupTestRepo(t)
	runner := &mockRunner{}
	scheduler := daemon.NewScheduler(repo, runner, 50*time.Millisecond)

	scheduler.Start()
	// Calling Start again should be a safe no-op
	scheduler.Start()

	time.Sleep(100 * time.Millisecond)

	scheduler.Stop()
	// Calling Stop again should be a safe no-op
	scheduler.Stop()
}
