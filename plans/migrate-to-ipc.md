# Implementation Plan: Migration to IPC Transport

## Overview
Replace TCP-based communication (ports 7890/7892) with Inter-Process Communication (IPC) using Unix Domain Sockets on Linux/macOS and Named Pipes on Windows. This eliminates port conflicts and improves security.

## Proposed Changes

### 1. `src/shared/config.ts`
- Add `DAEMON_IPC_PATH`:
    - Windows: `\\\\.\\pipe\\pyrunner`
    - Unix: `~/.pyrunner/daemon.sock`
- Update `getDaemonUrl` to return `http://localhost` (a placeholder for fetch).
- Mark `DAEMON_PORT` and related logic as deprecated or remove if not needed.

### 2. `src/daemon/index.ts`
- Update `Bun.serve` to use the `unix` option:
    ```typescript
    Bun.serve({
      fetch: app.fetch,
      unix: DAEMON_IPC_PATH,
    });
    ```
- Update startup log to display the IPC path instead of the port.

### 3. `src/cli/client.ts`
- Update the `request` helper to include the `unix` option in `fetch`:
    ```typescript
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      unix: DAEMON_IPC_PATH,
      // ...
    });
    ```

### 4. `src/cli/commands/install.tsx` & `src/cli/commands/uninstall.tsx`
- Update manual `fetch` calls (for health checks and shutdown requests) to include the `unix: DAEMON_IPC_PATH` option.

## Validation Strategy
1. **Rebuild**: Run `bun run build`.
2. **Install**: Run `.\pyrunner.exe install`.
3. **Verify Connectivity**: Run `pyrunner list` and `pyrunner logs` using the new binary.
4. **Verify Port Privacy**: Run `netstat -ano | findstr :7892` and `netstat -ano | findstr :7890` to confirm NO TCP ports are being used by PyRunner.
5. **Cross-Platform**: (Internal check) Ensure the logic correctly handles both Windows Named Pipes and Unix Sockets.
