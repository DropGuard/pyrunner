# @dropguard/pyrunner 🚀

[![npm version](https://img.shields.io/npm/v/@dropguard/pyrunner.svg?style=flat-square)](https://www.npmjs.com/package/@dropguard/pyrunner)
[![license](https://img.shields.io/npm/l/@dropguard/pyrunner.svg?style=flat-square)](https://github.com/DropGuard/pyrunner/blob/main/LICENSE)

**PyRunner** is a lightweight, cross-platform Python script scheduler. Schedule, manage, and monitor Python tasks with Cron expressions — one command to install, zero runtime dependencies.

---

## ✨ Features

- **⚡ Lightweight & Fast**: Built with Bun for minimal overhead and maximum performance.
- **🛠️ Automated Environment**: Leverages `uv` for lightning-fast Python dependency management and script execution.
- **📅 Cron Scheduling**: Robust task scheduling using standard Cron syntax via `croner`.
- **🖥️ Service Integration**: Native background service support for Windows (Registry), Linux (systemd), and macOS (launchd).
- **📊 Real-time Monitoring**: Monitor task status, logs, and execution history through an interactive CLI.
- **🔒 Industrial Grade**: Atomic status updates, process tree cleanup, and strict UTF-8 encoding enforcement.

---

## 📦 Installation

Choose one of the following installation methods:

### Method 1: One-liner Script (Recommended 🌟)

No Node.js, NPM, or Bun runtime required. Automatically downloads the native binary for your platform, adds it to your user PATH, and installs the background daemon.

#### Windows (PowerShell)
```powershell
iwr -useb https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.ps1 | iex
```

#### macOS / Linux (Bash)
```bash
curl -fsSL https://raw.githubusercontent.com/DropGuard/pyrunner/main/scripts/install.sh | bash
```

---

### Method 2: Via NPM (Global Package)

Use this if you already have Node.js / NPM installed in your local environment:

```bash
npm install -g @dropguard/pyrunner
```

### Requirements

| Dependency | Why |
| :--- | :--- |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Python package management and script execution |
| [Python](https://www.python.org/) 3.8+ | Running your scripts |

---

## 🚀 Quick Start

### 1. Add a Task

Schedule a Python script to run every day at 9:00 AM:

```bash
pyrunner add my-task ./scripts/daily_report.py "0 9 * * *"
```

### 2. List Tasks

```bash
pyrunner list
```

### 3. Run Immediately

```bash
pyrunner run my-task
```

### 4. Install as a Background Service

Run PyRunner automatically on system boot:

```bash
pyrunner install

# Stop the daemon
pyrunner stop

# Remove the service
pyrunner uninstall
```

---

## 🛠️ CLI Reference

| Command | Description |
| :--- | :--- |
| `add <name> <script> [cron]` | Add a scheduled task (default: daily at noon). |
| `list` / `ls` | List all tasks with status and next run time. |
| `edit <name> -s <script> -c <cron>` | Update a task's script or cron expression. |
| `remove <name>` / `rm` | Delete a task. |
| `run [name]` | Run a task immediately (omit name to run all). |
| `kill [name]` | Kill a running task (omit name to kill all). |
| `logs [name] -n <lines>` | View task output logs. |
| `start` / `daemon` | Start the scheduler daemon manually. |
| `stop` | Stop the daemon. |
| `install` | Register as a system service (auto-start on boot). |
| `uninstall` | Remove the system service. |

---

## ⚠️ Encoding

PyRunner enforces UTF-8 everywhere:

- Sets `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for child processes.
- Invalid bytes are replaced with U+FFFD — never crashes, never corrupts logs.
- Windows: auto-configures console codepage to 65001.

---

## 📄 License

MIT © [DropGuard](https://github.com/rememberluo)
