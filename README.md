# @dropguard/pyrunner 🚀

[![npm version](https://img.shields.io/npm/v/@dropguard/pyrunner.svg?style=flat-square)](https://www.npmjs.com/package/@dropguard/pyrunner)
[![license](https://img.shields.io/npm/l/@dropguard/pyrunner.svg?style=flat-square)](https://github.com/DropGuard/pyrunner/blob/main/LICENSE)

**PyRunner** is a lightweight, cross-platform Python script scheduler powered by **Bun** and **uv**. It allows you to easily schedule, manage, and monitor Python tasks as background services with simple Cron expressions.

---

## ✨ Features

- **⚡ Lightweight & Fast**: Built with Bun for minimal overhead and maximum performance.
- **🛠️ Automated Environment**: Leverages `uv` for lightning-fast Python dependency management.
- **📅 Cron Scheduling**: Robust task scheduling using standard Cron syntax.
- **🖥️ Service Integration**: Native background service support for Windows (Registry), Linux (systemd), and macOS (launchd).
- **🛡️ Industrial Grade**: Atomic status updates, process tree cleanup, and strict encoding enforcement.
- **📝 Log Monitoring**: Built-in log management to track your script outputs.

---

## 📦 Installation

Install PyRunner globally via npm:

```bash
npm install -g @dropguard/pyrunner
```

*Note: Ensure you have [Bun](https://bun.sh) and [uv](https://github.com/astral-sh/uv) installed on your system.*

---

## 🚀 Quick Start

### 1. Add a Task
Schedule a Python script to run every day at 9:00 AM:
```bash
pyrunner add my-task ./scripts/daily_report.py "0 9 * * *"
```

### 2. List Tasks
Check the status of all your scheduled tasks:
```bash
pyrunner list
```

### 3. Run the Daemon
To start executing tasks, run the daemon:
```bash
pyrunner start
```

### 4. Install as a System Service
Run PyRunner automatically in the background when your system starts:
```bash
# Install the service
pyrunner install

# To stop the service
pyrunner stop

# To remove it later
pyrunner uninstall
```

---

## ⚠️ Important: Encoding & Versioning

To ensure reliability and prevent data corruption, PyRunner enforces a strict **UTF-8 Everywhere** policy:

- **Python Version**: Requires **Python 3.8+**.
- **Strict UTF-8**: PyRunner processes all output as UTF-8. 
- **Auto-Sanitization**: Any invalid non-UTF-8 bytes (e.g., from legacy scripts) are automatically replaced with the Unicode replacement character (). This ensures your **database and logs remain 100% valid UTF-8** and never get corrupted.
- **Windows**: PyRunner automatically configures the environment (`PYTHONUTF8=1`) to use UTF-8.

---

## 🛠️ CLI Reference

| Command | Description |
| :--- | :--- |
| `add <name> <script> [cron]` | Add a new scheduled task. |
| `list` / `ls` | List all tasks with their status and next run time. |
| `edit <name>` | Update a task's script, cron, or timeout. |
| `remove <name>` / `rm` | Delete a scheduled task. |
| `run <name>` | Run a task immediately (manual trigger). |
| `kill [name]` | Kill a specific running task or all tasks. |
| `start` / `daemon` | Start the scheduler (use `--hidden` on Windows for background). |
| `stop` | Stop the scheduler daemon. |
| `install` | Register PyRunner as a system-level background service. |
| `uninstall` | Remove the registered system service. |

---

## 📋 Requirements

- **Bun**: v1.0.0+
- **uv**: Latest version recommended.
- **Python**: v3.8+ (Strictly enforced).
- **OS**: Windows, macOS, or Linux.

---

## 📄 License

MIT © [DropGuard](https://github.com/rememberluo)
