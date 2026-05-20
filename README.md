# @dropguard/pyrunner

[![npm version](https://img.shields.io/npm/v/@dropguard/pyrunner.svg?style=flat-square)](https://www.npmjs.com/package/@dropguard/pyrunner)
[![license](https://img.shields.io/npm/l/@dropguard/pyrunner.svg?style=flat-square)](https://github.com/DropGuard/pyrunner/blob/main/LICENSE)

**PyRunner** is a lightweight, cross-platform Python script scheduler. Schedule, manage, and monitor Python tasks with Cron expressions — one command to install, zero runtime dependencies.

---

## Features

- **Lightweight**: Go-compiled static binary, no runtime dependencies.
- **Automated Environment**: Uses `uv` for Python dependency management and script execution.
- **Cron Scheduling**: Standard 5-field Cron expressions via `robfig/cron`.
- **Service Integration**: Auto-start on boot — Windows (Registry), Linux (XDG autostart), macOS (launchd).
- **Process Management**: Graceful kill (SIGTERM → SIGKILL), process tree cleanup, 10-minute timeout.
- **Strict UTF-8**: Enforces `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` on child processes.

---

## Installation

### One-liner Script (Recommended)

No Go, Node.js, or Python runtime required. Downloads the native binary for your platform.

**Windows (PowerShell)**
```powershell
iwr -useb https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.ps1 | iex
```

**macOS / Linux (Bash)**
```bash
curl -fsSL https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.sh | bash
```

### Via NPM

```bash
npm install -g @dropguard/pyrunner
```

### From Source

```bash
git clone https://github.com/DropGuard/pyrunner.git
cd pyrunner
make install
```

### Requirements

| Dependency | Why |
| :--- | :--- |
| [uv](https://docs.astral.sh/uv/) | Python package management and script execution |
| [Python](https://www.python.org/) 3.8+ | Running your scripts |

---

## Quick Start

```bash
# Schedule a Python script to run daily at 9:00 AM
pyrunner add my-task ./scripts/daily_report.py "0 9 * * *"

# List all tasks
pyrunner list

# Run immediately
pyrunner run my-task

# Install as a background service (auto-start on boot)
pyrunner install

# Stop the daemon
pyrunner stop

# Remove the service
pyrunner uninstall
```

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `add <name> <script> [cron]` | Add a scheduled task (default: daily at noon). |
| `list` / `ls` | List all tasks with status and next run time. |
| `edit <name> -s <script> -c <cron>` | Update a task's script or cron expression. |
| `remove <name>` / `rm` | Delete a task. |
| `run [name]` | Run a task immediately (all idle tasks if no name). |
| `kill [name]` | Kill a running task (all running tasks if no name). |
| `logs [name] -n <lines>` | View task logs (last execution if no name). |
| `start` / `daemon` | Start the scheduler daemon. |
| `stop` | Stop the daemon. |
| `install` | Register as a system service. |
| `uninstall` | Remove the system service. |

---

## Architecture

PyRunner uses a dual-binary architecture:

- **`pyrunner`** — CLI binary for user interaction.
- **`pyrunnerd`** — Daemon binary running as a background process.

The CLI communicates with the daemon over a Unix Domain Socket (HTTP via `go-chi/chi`). Job data is persisted in a local SQLite database at `~/.pyrunner/jobs.sqlite`.

---

## License

MIT © [DropGuard](https://github.com/rememberluo)
