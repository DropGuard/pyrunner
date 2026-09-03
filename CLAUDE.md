# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PyRunner** is a cross-platform Python script scheduler written in Go. You schedule Python scripts with 5-field cron expressions, and a background daemon runs them via `uv run`. Zero runtime dependencies — ships as two static binaries.

- **CLI**: `pyrunner` (cmd/pyrunner) — user-facing commands.
- **Daemon**: `pyrunnerd` (cmd/pyrunnerd) — background scheduler + HTTP server.

The CLI talks to the daemon over a Unix Domain Socket using HTTP (go-chi/chi). Job state persists in SQLite at `~/.pyrunner/jobs.sqlite`.

## Build & Test Commands

make build          # build both binaries into ./bin
make build-cli      # build only pyrunner
make build-daemon   # build only pyrunnerd
make test           # go test ./... -v -count=1 (includes cmd/ packages)
make vet            # go vet ./...
make install        # build + register as system service
make clean          # rm -rf ./bin

# Version is injected via ldflags; CI passes the git tag:
make build VERSION=v0.2.3


Run a single test:

go test ./internal/daemon/ -run TestDaemonRunToCompletion -v
go test ./internal/config/ -run TestNewFromEnv -v


CI (`.github/workflows/ci.yml`) runs build/test/vet on linux/windows/macos. The `integration_run_test.go` is `//go:build linux` because it needs a POSIX `uv` shim.

## Architecture

### Dual-binary flow
1. `pyrunner <cmd>` (CLI) → `internal/cli/client.go` wraps HTTP calls over a Unix socket.
2. `pyrunnerd` runs the HTTP server (`internal/daemon/routes.go`) and the scheduler.
3. Jobs are persisted via `internal/db/repository.go` (SQLite through sqlx).

### Key packages
- **`internal/config`** — paths for `~/.pyrunner/{bin,logs,repos,daemon.sock,jobs.sqlite}`. `ForTest(baseDir)` roots everything in a temp dir; `OpenMemory()` gives an in-memory DB for tests.
- **`internal/daemon`** — the core:
  - `routes.go` — `Server` struct; all `/api/v1/*` handlers; holds `repo`, `scheduler`, `executor`. The `Server.config` field is a **small interface** (`GetDaemonIpcPath/GetLogsDir/GetDefaultTimeout`) — test doubles implement just those methods.
  - `executor.go` — `Executor.ExecuteJob(job, trigger)` spawns the script and streams stdout/stderr to a log file. Log rotation is size-based (5 MiB → `.old`). `TriggerType` enum (`TriggerScheduled`/`TriggerCatchUp`/`TriggerManual`) decides the log label and whether `next_run_time` advances.
  - `scheduler.go` — `CronJobManager` wraps robfig/cron v3. `Schedule(name, expr, fn)` is idempotent (re-schedules by name). `CalculateNextRun` parses a 5-field cron and returns the next occurrence after a base time.
- **`internal/process`** — `Spawn` runs `uv run <script>` with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`. `Job` holds stdout/stderr pipes; `Wait()` maps to exit codes. `KillTree` (per-platform) SIGTERM→500ms→SIGKILL. Pipes **must** be created before `cmd.Start()` (see integration_run_test.go's comment on the historical bug).
- **`internal/singleton`** — cross-platform single-instance lock for the daemon. Unix: flock(2); Windows: named mutex (`CreateMutex`). Kernel-managed, no stale-lock cleanup.
- **`internal/cli/commands`** — cobra commands. `util.go` has `IsRemoteSource`/`RepoNameFromURL` for the "add from Git URL" feature, and `cloneRepo`. `autostart_*` are per-OS (build-tagged).
- **`internal/errors`** — `APIResponse{OK,Data,Error,Code}`, typed `ErrorCode` constants, `DaemonOfflineError`, `APIError`.
- **`internal/version`** — `version.String()`; injected at build via ldflags.

### Catch-up (compensation) semantics
On daemon start (`cmd/pyrunnerd/main.go`), `catchUpMissedJobs` runs every job whose `next_run_time` is already in the past (and not currently running) exactly **once** per missed slot. `robfig/cron` only schedules future occurrences, so without this a job missed while the daemon was down would never run. After the catch-up run, `ExecuteJob` advances `next_run_time` to the next future occurrence, so the daemon never double-runs or disturbs the next scheduled slot. This behavior is unit-tested in `cmd/pyrunnerd/main_test.go`.

### Trigger types & next_run advancement
- `TriggerScheduled` / `TriggerCatchUp` → advance `next_run_time` (consume the slot).
- `TriggerManual` (user `pyrunner run`) → do **not** advance `next_run_time`; the scheduled cadence is untouched.

## Testing patterns

- **DB tests** (`internal/db/repository_test.go`) use `OpenMemory()` — a shared in-memory DB, no temp files.
- **Config tests** (`internal/config/config_test.go`) test `newFromEnv` by injecting a fake `getenv` func, and `ForTest`/`EnsureEnv` against a temp dir.
- **Daemon integration** (`internal/daemon/integration_test.go`) boots the real Server on a Unix socket in a temp dir, then drives it through `internal/cli.Client`. Sets `daemon.ShutdownFn` and defers cleanup. Polls `/health` up to 5s before proceeding.
- **Run-to-completion** (`integration_run_test.go`, linux-only) uses a fake `uv` shim at `testdata/fakebin/uv` prepended to `PATH` so no real uv is needed.
- **Scheduler calc** (`scheduler_calc_test.go`) tests `CalculateNextRun` with explicit `time.Date` bases (including past-time → next future occurrence, never backfill).
- **Singleton** (`singleton_test.go`) spawns a helper subprocess to prove a second instance is rejected, then released.
- **Cross-platform** (`autostart_unix_test.go` / `autostart_windows_test.go`) are build-tagged; the unix test sets `HOME` to a temp dir and asserts the `.desktop` Exec line is an absolute path (not `~`).

When adding daemon behavior, prefer a unit test with a fake runner/executor over a full process spawn; reserve integration tests for end-to-end flow. Remember `OpenMemory` exists specifically to avoid touching real user state.
