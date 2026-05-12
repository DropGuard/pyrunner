# Implementation Plan: Revert PATH Management Changes

## Overview
Revert the recent changes that introduced automatic system `PATH` modification during installation and uninstallation. This aligns with the "Orthodox" principle that a service installer should not manage CLI path registration, which is the responsibility of the package manager (npm, scoop, etc.).

## Proposed Changes

### 1. `src/utils/process.ts`
- Remove the following functions:
    - `addPathToUser(pathToAdd: string)`
    - `removePathFromUser(pathToRemove: string)`
- Remove unused imports (`existsSync`, `appendFileSync`, `readFileSync`, `writeFileSync`, `homedir`).

### 2. `src/cli/commands/install.tsx`
- Remove the call to `addPathToUser(BIN_DIR)`.
- Remove `addPathToUser` from the imports.
- Re-index steps (if numbered) to maintain sequential order.

### 3. `src/cli/commands/uninstall.tsx`
- Remove the call to `removePathFromUser(BIN_DIR)`.
- Remove `removePathFromUser` from the imports.
- Re-index steps to maintain sequential order.

## Validation Strategy
1. **Build**: Run `bun run build` to ensure the project compiles without the removed functions.
2. **Installation Test**: Run `.\pyrunner.exe install`. Verify that:
    - The existing daemon is gracefully stopped using the old binary.
    - The new binary is copied correctly (`EBUSY` error does not occur).
    - The daemon starts successfully on the correct port (7892).
    - **Crucially**: The system `PATH` is NOT modified.
3. **Uninstallation Test**: Run `.\pyrunner.exe uninstall`. Verify that:
    - The daemon is stopped.
    - Files are removed.
    - **Crucially**: No attempts to modify `PATH` are made.
