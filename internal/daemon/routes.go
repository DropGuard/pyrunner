package daemon

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/DropGuard/pyrunner/internal/db"
	apperrors "github.com/DropGuard/pyrunner/internal/errors"
	"github.com/DropGuard/pyrunner/internal/process"
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
}

func NewServer(repo *db.Repository, scheduler *CronJobManager, executor *Executor, cfg interface {
	GetDaemonIpcPath() string
	GetLogsDir() string
	GetDefaultTimeout() int
}) *Server {
	return &Server{
		repo:      repo,
		scheduler: scheduler,
		executor:  executor,
		config:    cfg,
		startTime: time.Now(),
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
		"version": "0.2.0",
		"uptime":  time.Since(s.startTime).Seconds(),
	})
}

func (s *Server) handleDaemonStatus(w http.ResponseWriter, r *http.Request) {
	jobs, _ := s.repo.GetAll()
	writeOK(w, map[string]interface{}{
		"pid":      os.Getpid(),
		"ipc":      s.config.GetDaemonIpcPath(),
		"jobCount": len(jobs),
		"uptime":   time.Since(s.startTime).Seconds(),
	})
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.repo.GetAll()
	if err != nil {
		writeErr(w, 500, apperrors.ErrValidation, err.Error())
		return
	}
	writeOK(w, jobs)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	job, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
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
		writeErr(w, 500, apperrors.ErrValidation, err.Error())
		return
	}

	job, _ := s.repo.GetByName(req.Name)
	s.scheduler.Schedule(req.Name, req.Cron, func() {
		s.executor.ExecuteJob(job, false)
	})

	writeJSON(w, 201, apperrors.OK(map[string]interface{}{
		"name":         req.Name,
		"next_run_time": nextRun.UnixMilli(),
	}))
}

func (s *Server) handleEditJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
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
		writeErr(w, 500, apperrors.ErrValidation, err.Error())
		return
	}

	updated, _ := s.repo.GetByName(name)
	s.scheduler.Schedule(updated.Name, updated.Cron, func() {
		s.executor.ExecuteJob(updated, false)
	})

	writeOK(w, updated)
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	s.scheduler.Unschedule(name)
	deleted, err := s.repo.Delete(name)
	if err != nil {
		writeErr(w, 500, apperrors.ErrValidation, err.Error())
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
	job, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
		return
	}
	if job.Status == db.JobStatusRunning {
		writeErr(w, 409, apperrors.ErrAlreadyRunning, "Task '"+name+"' is already running")
		return
	}

	updated, err := s.repo.MarkAsRunning(job.ID)
	if err != nil || updated == nil {
		writeErr(w, 409, apperrors.ErrAlreadyRunning, "Task '"+name+"' is already running")
		return
	}

	// Fire and forget
	go s.executor.ExecuteJob(updated, true)

	writeOK(w, map[string]string{"triggered": name})
}

func (s *Server) handleKillJob(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	job, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
		return
	}
	if job.Status != db.JobStatusRunning || job.PID == nil {
		writeErr(w, 400, apperrors.ErrValidation, "Task '"+name+"' is not running")
		return
	}

	if err := process.KillTree(*job.PID, true); err != nil {
		writeErr(w, 500, apperrors.ErrValidation, "Failed to kill task: "+err.Error())
		return
	}
	writeOK(w, map[string]string{"killed": name})
}

func (s *Server) handleKillAll(w http.ResponseWriter, r *http.Request) {
	jobs, _ := s.repo.GetAll()
	killed := 0
	for _, job := range jobs {
		if job.Status == db.JobStatusRunning && job.PID != nil {
			if err := process.KillTree(*job.PID, true); err == nil {
				killed++
			}
		}
	}
	writeOK(w, map[string]int{"killed": killed})
}

func (s *Server) handleGetJobLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := s.repo.GetByName(name)
	if err != nil {
		writeErr(w, 404, apperrors.ErrJobNotFound, "Task '"+name+"' not found")
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
		// parse int
		for _, c := range l {
			if c >= '0' && c <= '9' {
				lines = lines*10 + int(c-'0')
			}
		}
	}

	if lines > 0 {
		allLines := strings.Split(string(content), "\n")
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
	jobs, _ := s.repo.GetAll()
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

var ShutdownFn func()

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]bool{"shutting_down": true})
	if ShutdownFn != nil {
		go func() {
			time.Sleep(100 * time.Millisecond)
			ShutdownFn()
		}()
	}
}
