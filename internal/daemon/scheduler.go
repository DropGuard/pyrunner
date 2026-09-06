package daemon

import (
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
)

// CronJobManager manages active cron schedules for jobs.
type CronJobManager struct {
	mu         sync.Mutex
	activeJobs map[string]*cron.Cron
	parser     cron.Parser
	recoverOpt cron.Option
}

func NewCronJobManager() *CronJobManager {
	// Recover turns a panic inside a job closure into a logged error instead
	// of an unrecovered goroutine panic that would crash the whole daemon.
	// A scheduler daemon is expected to survive a bad run and keep the rest
	// of the schedule going.
	logger := cron.PrintfLogger(log.New(os.Stderr, "[pyrunnerd] ", log.LstdFlags))
	return &CronJobManager{
		activeJobs: make(map[string]*cron.Cron),
		parser:     cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow),
		recoverOpt: cron.WithChain(cron.Recover(logger)),
	}
}

// Schedule registers a cron job. If a job with the same name already exists,
// it is unscheduled first.
func (m *CronJobManager) Schedule(name, expr string, fn func()) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.unscheduleLocked(name)

	c := cron.New(cron.WithParser(m.parser), m.recoverOpt)
	if _, err := c.AddFunc(expr, fn); err != nil {
		return fmt.Errorf("invalid cron %q: %w", expr, err)
	}
	c.Start()
	m.activeJobs[name] = c
	return nil
}

// Unschedule stops and removes a cron job by name.
func (m *CronJobManager) Unschedule(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.unscheduleLocked(name)
}

func (m *CronJobManager) unscheduleLocked(name string) {
	if c, ok := m.activeJobs[name]; ok {
		c.Stop()
		delete(m.activeJobs, name)
	}
}

// StopAll stops all active cron jobs.
func (m *CronJobManager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for name, c := range m.activeJobs {
		c.Stop()
		delete(m.activeJobs, name)
	}
}

// CalculateNextRun computes the next run time for a cron expression.
func CalculateNextRun(expr string, baseTime time.Time) (time.Time, error) {
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(expr)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse cron %q: %w", expr, err)
	}
	return schedule.Next(baseTime), nil
}
