# @dropguard/pyrunner 🚀

**PyRunner** is a lightweight, cross-platform Python script scheduler powered by **Bun** and **uv**. It allows you to easily schedule, manage, and monitor Python tasks as background services with simple Cron expressions.

---

## ✨ Features

- **⚡ Lightweight & Fast**: Built with Bun for minimal overhead and maximum performance.
- **🛠️ Automated Environment**: Leverages `uv` for lightning-fast Python dependency management.
- **📅 Cron Scheduling**: Robust task scheduling using standard Cron syntax.
- **🖥️ Service Integration**: Install as a native system service (Windows Service, systemd, or macOS Launchd) with one command.
- **📊 Task Management**: Easily add, list, edit, and remove tasks via an intuitive CLI.
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
pyrunner daemon
```

### 4. Install as a System Service
Run PyRunner automatically in the background when your system starts:
```bash
# Install the service
pyrunner install

# To remove it later
pyrunner uninstall
```

---

## 🛠️ CLI Reference

| Command | Description |
| :--- | :--- |
| `add <name> <script> <cron>` | Add a new scheduled task. |
| `list` | List all tasks with their status and next run time. |
| `edit <name>` | Update a task's script path or cron expression. |
| `remove <name>` | Delete a scheduled task. |
| `logs <name>` | View the latest output logs for a specific task. |
| `daemon` | Start the scheduler in the foreground. |
| `install` | Register PyRunner as a system-level background service. |
| `uninstall` | Remove the registered system service. |

---

## 📋 Requirements

- **Bun**: v1.0.0+
- **uv**: Latest version recommended (for Python environment management)
- **OS**: Windows, macOS, or Linux

---

## 📄 License

MIT © [DropGuard](https://github.com/rememberluo)
