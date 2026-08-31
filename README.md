# @dropguard/pyrunner

[![npm version](https://img.shields.io/npm/v/@dropguard/pyrunner.svg?style=flat-square)](https://www.npmjs.com/package/@dropguard/pyrunner)
[![CI](https://img.shields.io/github/actions/workflow/status/DropGuard/pyrunner/ci.yml?style=flat-square&branch=main)](https://github.com/DropGuard/pyrunner/actions)
[![license](https://img.shields.io/npm/l/@dropguard/pyrunner.svg?style=flat-square)](https://github.com/DropGuard/pyrunner/blob/main/LICENSE)

**PyRunner** schedules Python scripts on **your own machine** — a small background daemon, cron expressions, no server, no ops.

You point it at a script (or a Git repo), pick a schedule, and forget about it. Built for personal computers and laptops: installs per-user, writes only to `~/.pyrunner`, and behaves sensibly across sleep / shutdown / login.

---

## Features

- **Lightweight** — Go-compiled static binaries, no Go/Node/Python runtime required to install.
- **Powered by [`uv`](https://docs.astral.sh/uv/)** — Python dependency management and script execution out of the box.
- **Cron scheduling** — standard 5-field expressions via [`robfig/cron`](https://github.com/robfig/cron).
- **System service (user-level)** — runs as the logged-in user; writes only to `~/.pyrunner`. Auto-start on login: Linux (XDG `.desktop`), Windows (Registry `HKCU\…\Run`), macOS (LaunchAgent `~/Library/LaunchAgents/com.dropguard.pyrunner.plist`).
- **Process management** — graceful SIGTERM → SIGKILL, process-tree cleanup, per-job timeout.
- **Strict UTF-8** — `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` are always set on children.
- **Tight permissions** — `~/.pyrunner` is `0700` and SQLite files are `0600` (multi-user safe).
- **Schedule from Git** — point `add` at a repo URL and PyRunner clones it for you.

---

## Installation

### One-liner script (recommended)

No Go, Node.js, or Python runtime needed — downloads the native binary for your platform.

**Windows (PowerShell)**
```powershell
iwr -useb https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.ps1 | iex
```

**macOS / Linux (Bash)**
```bash
curl -fsSL https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.sh | bash
```

### Via npm

```bash
npm install -g @dropguard/pyrunner
```

### From source

```bash
git clone https://github.com/DropGuard/pyrunner.git
cd pyrunner
make install
```

### Requirements

| Dependency | Why |
| :--- | :--- |
| [`uv`](https://docs.astral.sh/uv/) | Python package management + script execution |
| [Python](https://www.python.org/) 3.8+ | Runs your scripts (managed by `uv`) |

---

## Quick start

```bash
# Schedule a local Python script — daily at 9:00 AM
pyrunner add my-task ./scripts/daily_report.py "0 9 * * *"

# Or schedule a Git repo directly
pyrunner add owner/repo "*/30 * * * *"

pyrunner list                # show all tasks with status & next run
pyrunner run my-task         # trigger now (without advancing the schedule)
pyrunner logs my-task -n 50  # tail the last 50 lines

pyrunner install             # deploy + register as a system service
pyrunner uninstall -w        # remove the service and wipe all data
```

`install` deploys both binaries and registers the daemon for auto-start on login (where supported). To run interactively without the service, use `pyrunner start` / `pyrunner stop` instead.

---

## CLI reference

✅ = you'll reach for these in daily use.

### Common

| Command | Description |
| :--- | :--- |
| ✅ `add <name> <script> [cron]` | Add a local task. Default cron: `0 12 * * *`. |
| ✅ `add <url> [cron]` | Clone a Git repo and schedule it. Name = repo name. |
| ✅ `list` *(`ls`)* | List tasks with status and next run time. |
| ✅ `run [name]` | Trigger now (all idle tasks if `name` omitted). Does **not** advance the schedule. |
| ✅ `logs [name] -n <lines>` | Show logs — last execution of every task if `name` omitted. |
| ✅ `remove <name>` *(`rm`)* | Delete a task. |

### Service lifecycle

| Command | Description |
| :--- | :--- |
| `install` | Deploy binaries + register auto-start (where supported). |
| `uninstall [-w]` | Unregister. `-w` also wipes `~/.pyrunner` (logs, DB, repos). |
| `start` *(`daemon`)* | Start the daemon in the background. Idempotent. |
| `stop` | Stop the daemon. |

### Advanced

| Command | Description |
| :--- | :--- |
| `edit <name> (-s <script> \| -c <cron>)` | Update a task. At least one flag required. |
| `kill [name]` | SIGTERM a running task (all running if `name` omitted). |

Run `pyrunner <command> --help` for full flag details.

---

## Scheduling from a Git repository

Point `add` at a URL instead of a local script — PyRunner clones it (shallow) and schedules it for you.

```bash
pyrunner add https://github.com/owner/repo            # clone, daily at noon
pyrunner add owner/repo "*/30 * * * *"                # shorthand
pyrunner add git@github.com:owner/repo.git             # SSH works too
```

Defaults you can override later via `edit`:

- **Task name** — derived from the repo name.
- **Cron** — `0 12 * * *` (daily at noon).
- **Entrypoint** — `main.py` at the repo root, run via `uv run`. If the repo has no `main.py`, `add` warns and still registers the task — repoint it with `pyrunner edit <name> -s <script>`.
- **Snapshots** — cloned once into `~/.pyrunner/repos/<name>` at add time. To refresh the code, `pyrunner remove <name>` (also deletes the snapshot) then `add` again.

Private repositories use your machine's Git credential helper (e.g. `gh auth setup-git`) — PyRunner stores no tokens. First run of a repo using Playwright needs a one-time `uv run playwright install chromium`; browser binaries are shared machine-wide under `~/.cache/ms-playwright`.

---

## Architecture

```
                ┌──────────────────────────────┐
  user shell ─▶ │  pyrunner   (CLI, foreground)│
                └──────────────┬───────────────┘
                               │  HTTP over Unix socket
                               ▼
                ┌──────────────────────────────┐
                │  pyrunnerd  (background)     │
                │  ├─ scheduler (robfig/cron)  │
                │  ├─ HTTP server (go-chi)     │
                │  └─ executor → uv run …      │
                └──────────────┬───────────────┘
                               ▼
                  ~/.pyrunner/jobs.sqlite  (SQLite)
                  ~/.pyrunner/repos/       (cloned snapshots)
                  ~/.pyrunner/logs/        (per-task stdout/err)
```

- **`pyrunner`** — CLI binary for user interaction.
- **`pyrunnerd`** — Daemon binary, the only long-running process.
- IPC: Unix Domain Socket at `~/.pyrunner/daemon.sock`.
- Persistence: SQLite (job state) + filesystem (logs, cloned repos).

---

## FAQ

**Where do logs live?**
`~/.pyrunner/logs/<task-name>.log` (rotates to `.log.old` at 5 MiB). View with `pyrunner logs <name>`.

**Does `pyrunner run` shift the schedule?**
No — manual runs are fire-and-forget; the next cron occurrence is untouched.

**Where does state live?**
Everything is under `~/.pyrunner/`: `bin/`, `logs/`, `repos/`, `daemon.sock`, `jobs.sqlite`. The directory is created with mode `0700`.

**How do I uninstall cleanly?**
`pyrunner uninstall -w` removes the service and **all** state (logs, DB, repos). Without `-w`, state is preserved so a reinstall can pick it up.

---

## Development

```bash
make build          # build both binaries into ./bin
make test           # go test ./internal/... -v -count=1
make vet            # go vet ./...
make install        # build + register as a system service
```

CI builds and tests on Ubuntu, Windows, and macOS. See [CLAUDE.md](./CLAUDE.md) for the full architecture write-up.

---

## License

MIT © [DropGuard](https://github.com/rememberluo)
