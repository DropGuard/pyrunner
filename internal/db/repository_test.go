package db

import (
	"testing"
	"time"
)

func setupTestDB(t *testing.T) *Repository {
	t.Helper()
	db, err := OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewRepository(db)
}

func TestAddAndGetAll(t *testing.T) {
	repo := setupTestDB(t)

	nextRun := time.Now().UnixMilli()
	err := repo.Add(AddJobRequest{Name: "test-job", ScriptPath: "/tmp/test.py", Cron: "0 12 * * *"}, nextRun)
	if err != nil {
		t.Fatal(err)
	}

	jobs, err := repo.GetAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("got %d jobs, want 1", len(jobs))
	}
	if jobs[0].Name != "test-job" {
		t.Errorf("name = %q", jobs[0].Name)
	}
	if jobs[0].Status != JobStatusIdle {
		t.Errorf("status = %q", jobs[0].Status)
	}
}

func TestGetByName(t *testing.T) {
	repo := setupTestDB(t)

	nextRun := time.Now().UnixMilli()
	repo.Add(AddJobRequest{Name: "my-job", ScriptPath: "/tmp/my.py", Cron: "*/5 * * * *"}, nextRun)

	job, err := repo.GetByName("my-job")
	if err != nil {
		t.Fatal(err)
	}
	if job.ScriptPath != "/tmp/my.py" {
		t.Errorf("script_path = %q", job.ScriptPath)
	}

	_, err = repo.GetByName("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent job")
	}
}

func TestGetDueJobs(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	repo.Add(AddJobRequest{Name: "past", ScriptPath: "/tmp/p.py", Cron: "* * * * *"}, now-1000)
	repo.Add(AddJobRequest{Name: "future", ScriptPath: "/tmp/f.py", Cron: "* * * * *"}, now+100000)

	due, err := repo.GetDueJobs(now)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 {
		t.Fatalf("got %d due jobs, want 1", len(due))
	}
	if due[0].Name != "past" {
		t.Errorf("name = %q", due[0].Name)
	}
}

func TestMarkAsRunning(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	repo.Add(AddJobRequest{Name: "job1", ScriptPath: "/tmp/j.py", Cron: "* * * * *"}, now)

	jobs, _ := repo.GetAll()
	job := jobs[0]

	updated, err := repo.MarkAsRunning(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated == nil {
		t.Fatal("expected job to be marked as running")
	}
	if updated.Status != JobStatusRunning {
		t.Errorf("status = %q, want running", updated.Status)
	}
	if updated.LastRunTime == nil {
		t.Error("last_run_time should be set")
	}

	// Second attempt should return nil (already running)
	again, err := repo.MarkAsRunning(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again != nil {
		t.Error("expected nil for already-running job")
	}
}

func TestFinalize(t *testing.T) {
	repo := setupTestDB(t)

	now := time.Now().UnixMilli()
	repo.Add(AddJobRequest{Name: "fin", ScriptPath: "/tmp/f.py", Cron: "* * * * *"}, now)

	jobs, _ := repo.GetAll()
	job := jobs[0]
	repo.MarkAsRunning(job.ID)

	nextRun := now + 60000
	err := repo.Finalize(job.ID, 0, nextRun, JobStatusIdle)
	if err != nil {
		t.Fatal(err)
	}

	updated, _ := repo.GetByName("fin")
	if updated.Status != JobStatusIdle {
		t.Errorf("status = %q", updated.Status)
	}
	if updated.LastExitCode == nil || *updated.LastExitCode != 0 {
		t.Errorf("exit_code = %v", updated.LastExitCode)
	}
	if updated.PID != nil {
		t.Errorf("pid should be nil after finalize, got %v", updated.PID)
	}
}

func TestDelete(t *testing.T) {
	repo := setupTestDB(t)

	repo.Add(AddJobRequest{Name: "del", ScriptPath: "/tmp/d.py", Cron: "* * * * *"}, 0)

	deleted, err := repo.Delete("del")
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Error("expected true")
	}

	deleted, err = repo.Delete("nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if deleted {
		t.Error("expected false for nonexistent")
	}
}

func TestUpdate(t *testing.T) {
	repo := setupTestDB(t)

	repo.Add(AddJobRequest{Name: "upd", ScriptPath: "/tmp/old.py", Cron: "0 * * * *"}, 0)

	newPath := "/tmp/new.py"
	err := repo.Update("upd", EditJobRequest{ScriptPath: &newPath}, nil)
	if err != nil {
		t.Fatal(err)
	}

	job, _ := repo.GetByName("upd")
	if job.ScriptPath != "/tmp/new.py" {
		t.Errorf("script_path = %q", job.ScriptPath)
	}
}

func TestUpdatePID(t *testing.T) {
	repo := setupTestDB(t)

	repo.Add(AddJobRequest{Name: "pid", ScriptPath: "/tmp/p.py", Cron: "* * * * *"}, 0)
	jobs, _ := repo.GetAll()

	err := repo.UpdatePID(jobs[0].ID, 12345)
	if err != nil {
		t.Fatal(err)
	}

	job, _ := repo.GetByName("pid")
	if job.PID == nil || *job.PID != 12345 {
		t.Errorf("pid = %v", job.PID)
	}
}

func TestCleanupStaleJobs(t *testing.T) {
	repo := setupTestDB(t)

	repo.Add(AddJobRequest{Name: "stale", ScriptPath: "/tmp/s.py", Cron: "* * * * *"}, 0)
	jobs, _ := repo.GetAll()
	repo.MarkAsRunning(jobs[0].ID)
	repo.UpdatePID(jobs[0].ID, 999)

	err := repo.CleanupStaleJobs()
	if err != nil {
		t.Fatal(err)
	}

	job, _ := repo.GetByName("stale")
	if job.Status != JobStatusIdle {
		t.Errorf("status = %q, want idle", job.Status)
	}
	if job.PID != nil {
		t.Errorf("pid should be nil after cleanup, got %v", job.PID)
	}
}
