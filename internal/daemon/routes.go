package daemon

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/DropGuard/pyrunner/internal/db"
	apperrors "github.com/DropGuard/pyrunner/internal/errors"
	"github.com/DropGuard/pyrunner/internal/process"
	"github.com/DropGuard/pyrunner/internal/version"
)

type Server struct {
	repo      *db.Repository
	scheduler *CronJobManager
	executor  *Executor
	config    interface {
		GetDaemonIpcPath() string
		GetLogsDir() string
		GetDefaultTimeout() int
	}
	startTime time.Time
	// shutdown runs the daemon's teardown when the HTTP /daemon/shutdown
	// endpoint is hit. It is injected at construction (not a package-level
	// var) so tests can pass their own teardown and run in parallel without
	// clobbering each other.
	shutdown func()
}

func NewServer(repo *db.Repository, scheduler *CronJobManager, executor *Executor, cfg interface {
	GetDaemonIpcPath() string
	GetLogsDir() string
	GetDefaultTimeout() int
}, shutdown func()) *Server {
	return &Server{
		repo:      repo,
		scheduler: scheduler,
		executor:  executor,
		config:    cfg,
		startTime: time.Now(),
		shutdown:  shutdown,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", s.handleHealth)
		r.Get("/daemon/status", s.handleDaemonStatus)

		r.Route("/jobs", func(r chi.Router) {
			r.Get("/", s.handleListJobs)
			r.Post("/", s.handleAddJob)
			r.Post("/kill-all", s.handleKillAll)
			r.Get("/{name}", s.handleGetJob)
			r.Patch("/{name}", s.handleEditJob)
			r.Delete("/{name}", s.handleDeleteJob)
			r.Post("/{name}/run", s.handleRunJob)
			r.Post("/{name}/kill", s.handleKillJob)
			r.Get("/{name}/logs", s.handleGetJobLogs)
		})

		r.Get("/logs", s.handleGetAllLogs)
		r.Post("/daemon/shutdown", s.handleShutdown)
	})

	return r
}

// SetShutdown wires the teardown closure into the Server so the
// /daemon/shutdown endpoint can trigger it. It is separate from NewServer so
// callers can construct the Server (and its Router) before building the
// teardown, which typically needs to close the HTTP server that wraps the
// Router.
func (s *Server) SetShutdown(fn func()) {
	s.shutdown = fn
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeOK(w http.ResponseWriter, data interface{}) {
	writeJSON(w, http.StatusOK, apperrors.OK(data))
}

func writeErr(w http.ResponseWriter, status int, code apperrors.ErrorCode, msg string) {
	writeJSON(w, status, apperrors.Err(code, msg))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]interface{}{
		"status":  "ok",
		"version": version.String(),
		"uptime":  time.Since(s.startTime).Seconds(),
	})
}

func (s *Server) handleDaemonStatus(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.repo.GetAll()
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}
	writeOK(w, map[string]interface{}{
		"pid":      os.Getpid(),
		"ipc":      s.config.GetDaemonIpcPath(),
		"jobCount": len(jobs),
		"uptime":   time.Since(s.startTime).Seconds(),
	})
}

// getJobOrRespond fetches a job by name, writing the appropriate error
// response itself when the lookup fails: 404 only for a genuinely missing
// row, 500 for a database failure (which must not masquerade as "task not
// found" — that sends users debugging the wrong thing). Returns nil when a
// response was written.
func (s *Server) getJobOrRespond(w http.ResponseWriter, name string) *db.Job {
	job, err := s.repo.GetByName(name)
	if err == nil {
		return job
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
		return nil
	}
	writeErr(w, 500, apperrors.ErrInternal, err.Error())
	return nil
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.repo.GetAll()
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}
	writeOK(w, jobs)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	job := s.getJobOrRespond(w, name)
	if job == nil {
		return
	}
	writeOK(w, job)
}

func (s *Server) handleAddJob(w http.ResponseWriter, r *http.Request) {
	var req db.AddJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, apperrors.ErrValidation, "Invalid request body")
		return
	}

	if req.Name == "" || req.ScriptPath == "" || req.Cron == "" {
		writeErr(w, 400, apperrors.ErrValidation, "Missing required fields: name, script_path, cron")
		return
	}

	// Task names become log file names and repo directory names verbatim, so
	// they are validated structurally here (the authoritative write path):
	// path separators, traversal segments, whitespace and Windows reserved
	// device names are rejected before a job can be persisted with a name that
	// would later escape ~/.pyrunner/logs or ~/.pyrunner/repos.
	if err := db.ValidateTaskName(req.Name); err != nil {
		writeErr(w, 400, apperrors.ErrValidation, err.Error())
		return
	}

	absPath, err := filepath.Abs(req.ScriptPath)
	if err != nil {
		writeErr(w, 400, apperrors.ErrValidation, "Invalid script path")
		return
	}

	nextRun, err := CalculateNextRun(req.Cron, time.Now())
	if err != nil {
		writeErr(w, 400, apperrors.ErrValidation, "Invalid cron expression: "+req.Cron)
		return
	}

	if err := s.repo.Add(db.AddJobRequest{
		Name:       req.Name,
		ScriptPath: absPath,
		Cron:       req.Cron,
	}, nextRun.UnixMilli()); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, 409, apperrors.ErrNameConflict, "Task '"+req.Name+"' already exists")
			return
		}
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}

	// The scheduled closure captures the persisted row. Persisting can only
	// be observed here; silently scheduling with a nil job would panic the
	// cron goroutine at fire time and take the whole daemon down with it.
	job, err := s.repo.GetByName(req.Name)
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, "task added but could not be loaded: "+err.Error())
		return
	}
	if err := s.scheduler.Schedule(req.Name, req.Cron, func() {
		s.executor.ExecuteJob(job, TriggerScheduled)
	}); err != nil {
		// The cron was validated above with the same parser options, so this
		// is practically unreachable — but a task that is persisted yet never
		// scheduled must not look like a success.
		writeErr(w, 500, apperrors.ErrInternal, "task added but could not be scheduled: "+err.Error())
		return
	}

	writeJSON(w, 201, apperrors.OK(map[string]interface{}{
		"name":          req.Name,
		"next_run_time": nextRun.UnixMilli(),
	}))
}

func (s *Server) handleEditJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if s.getJobOrRespond(w, name) == nil {
		return
	}

	var body struct {
		ScriptPath *string `json:"script_path"`
		Cron       *string `json:"cron"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, apperrors.ErrValidation, "Invalid request body")
		return
	}

	editReq := db.EditJobRequest{}
	var nextRun *int64

	if body.ScriptPath != nil {
		absPath, err := filepath.Abs(*body.ScriptPath)
		if err != nil {
			writeErr(w, 400, apperrors.ErrValidation, "Invalid script path")
			return
		}
		editReq.ScriptPath = &absPath
	}
	if body.Cron != nil {
		nr, err := CalculateNextRun(*body.Cron, time.Now())
		if err != nil {
			writeErr(w, 400, apperrors.ErrValidation, "Invalid cron expression: "+*body.Cron)
			return
		}
		editReq.Cron = body.Cron
		t := nr.UnixMilli()
		nextRun = &t
	}

	if editReq.ScriptPath == nil && editReq.Cron == nil {
		writeErr(w, 400, apperrors.ErrValidation, "No changes specified")
		return
	}

	if err := s.repo.Update(name, editReq, nextRun); err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}

	updated, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, "task updated but could not be reloaded: "+err.Error())
		return
	}
	if err := s.scheduler.Schedule(updated.Name, updated.Cron, func() {
		s.executor.ExecuteJob(updated, TriggerScheduled)
	}); err != nil {
		writeErr(w, 500, apperrors.ErrInternal, "task updated but could not be re-scheduled: "+err.Error())
		return
	}

	writeOK(w, updated)
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	s.scheduler.Unschedule(name)
	deleted, err := s.repo.Delete(name)
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}
	if !deleted {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
		return
	}
	writeOK(w, map[string]string{"deleted": name})
}

func (s *Server) handleRunJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	job := s.getJobOrRespond(w, name)
	if job == nil {
		return
	}

	// Fast-path reject when the job is already running. The authoritative
	// duplicate guard lives in ExecuteJob (its MarkAsRunning is an atomic
	// conditional UPDATE), which also covers races between the scheduler, the
	// catch-up pass and this endpoint. This pre-check is just so the common
	// double-run case fails fast with a clear 409.
	if job.Status == db.JobStatusRunning {
		writeErr(w, 409, apperrors.ErrAlreadyRunning, "Task '"+name+"' is already running")
		return
	}

	// Fire and forget. Do NOT pre-mark the job as running here: ExecuteJob's
	// MarkAsRunning is the single atomic gate, and pre-marking would make that
	// gate reject this very run (the row is already "running" by the time
	// ExecuteJob checks it), silently swallowing the trigger.
	go s.executor.ExecuteJob(job, TriggerManual)

	writeOK(w, map[string]string{"triggered": name})
}

func (s *Server) handleKillJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	job := s.getJobOrRespond(w, name)
	if job == nil {
		return
	}
	if job.Status != db.JobStatusRunning || job.PID == nil {
		writeErr(w, 400, apperrors.ErrValidation, "Task '"+name+"' is not running")
		return
	}

	// Graceful: SIGTERM first, escalating to SIGKILL after a short grace
	// period, so a script gets the chance to flush and clean up. Killing a
	// tree that has already exited is treated as success.
	if err := process.KillTree(*job.PID, false); err != nil {
		writeErr(w, 500, apperrors.ErrInternal, "Failed to kill task: "+err.Error())
		return
	}
	writeOK(w, map[string]string{"killed": name})
}

func (s *Server) handleKillAll(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.repo.GetAll()
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}
	killed := 0
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, job := range jobs {
		if job.Status == db.JobStatusRunning && job.PID != nil {
			wg.Add(1)
			go func(pid int) {
				defer wg.Done()
				// Concurrent graceful kills: each carries its own
				// TERM→KILL grace delay, which must not serialize.
				if err := process.KillTree(pid, false); err == nil {
					mu.Lock()
					killed++
					mu.Unlock()
				}
			}(*job.PID)
		}
	}
	wg.Wait()
	writeOK(w, map[string]int{"killed": killed})
}

func (s *Server) handleGetJobLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if s.getJobOrRespond(w, name) == nil {
		return
	}

	logPath := filepath.Join(s.config.GetLogsDir(), name+".log")
	content, err := os.ReadFile(logPath)
	if err != nil {
		writeOK(w, map[string]string{"content": ""})
		return
	}

	lines := 0
	if l := r.URL.Query().Get("lines"); l != "" {
		var err error
		if lines, err = strconv.Atoi(l); err != nil || lines < 0 {
			writeErr(w, 400, apperrors.ErrValidation, "Invalid lines parameter: "+l)
			return
		}
	}

	if lines > 0 {
		// Drop the final newline before splitting so it doesn't count as an
		// extra (empty) last line — `logs -n 1` must show the last real line.
		allLines := strings.Split(strings.TrimSuffix(string(content), "\n"), "\n")
		if lines > len(allLines) {
			lines = len(allLines)
		}
		writeOK(w, map[string]string{"content": strings.Join(allLines[len(allLines)-lines:], "\n")})
		return
	}

	// Default: only the last execution block
	writeOK(w, map[string]string{"content": extractLastBlock(string(content))})
}

func (s *Server) handleGetAllLogs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.repo.GetAll()
	if err != nil {
		writeErr(w, 500, apperrors.ErrInternal, err.Error())
		return
	}
	logs := make(map[string]string)
	for _, job := range jobs {
		logPath := filepath.Join(s.config.GetLogsDir(), job.Name+".log")
		content, err := os.ReadFile(logPath)
		if err != nil {
			logs[job.Name] = ""
			continue
		}

		logs[job.Name] = extractLastBlock(string(content))
	}
	writeOK(w, logs)
}

const logMarker = "================================================================================\n[RUN STARTED]"

func extractLastBlock(content string) string {
	blocks := strings.Split(content, logMarker)
	if len(blocks) > 1 {
		return logMarker + blocks[len(blocks)-1]
	}
	return content
}

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]bool{"shutting_down": true})
	if fn := s.shutdown; fn != nil {
		// Run the teardown on a goroutine after responding, so the HTTP client
		// receives the acknowledgement before the listener closes.
		go func() {
			time.Sleep(100 * time.Millisecond)
			fn()
		}()
	}
}
