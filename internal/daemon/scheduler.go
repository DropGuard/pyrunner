package daemon

import (
	"fmt"
	"sync"
	"time"

	"github.com/DropGuard/pyrunner/internal/db"
	"github.com/robfig/cron/v3"
)

// JobRunner abstracts job execution so tests can mock or monitor job runs.
type JobRunner interface {
	ExecuteJob(job *db.Job, trigger TriggerType)
}

// Scheduler checks for due jobs in the database and executes them.
type Scheduler struct {
	repo     *db.Repository
	runner   JobRunner
	interval time.Duration
	stopCh   chan struct{}
	wg       sync.WaitGroup
	mu       sync.Mutex
	running  bool
}

// NewScheduler creates a heartbeat-driven scheduler.
func NewScheduler(repo *db.Repository, runner JobRunner, interval time.Duration) *Scheduler {
	return &Scheduler{
		repo:     repo,
		runner:   runner,
		interval: interval,
		stopCh:   make(chan struct{}),
	}
}

// Tick evaluates all jobs in the database against the given time,
// triggering any jobs that are due (next_run_time <= now) and idle.
// It returns the number of jobs triggered.
func (s *Scheduler) Tick(now time.Time) int {
	dueJobs, err := s.repo.GetDueJobs(now.UnixMilli())
	if err != nil {
		return 0
	}

	count := 0
	for _, job := range dueJobs {
		job := job // capture
		go s.runner.ExecuteJob(&job, TriggerScheduled)
		count++
	}
	return count
}

// Start begins the background heartbeat loop.
func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// Run initial tick immediately on start (handles catch-up on cold start)
		s.Tick(time.Now())

		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		for {
			select {
			case now := <-ticker.C:
				s.Tick(now)
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop halts the background heartbeat loop.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	s.mu.Unlock()
	s.wg.Wait()
}

// CalculateNextRun computes the next run time for a cron expression based on baseTime.
func CalculateNextRun(expr string, baseTime time.Time) (time.Time, error) {
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(expr)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse cron %q: %w", expr, err)
	}
	return schedule.Next(baseTime), nil
}
