#!/usr/bin/env node

/**
 * Main entry point for npm distribution.
 * Strictly proxies to the service-installed binary for consistent IPC communication.
 */

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { existsSync } = require("node:fs");
const homedir = require("node:os").homedir();

const binName = process.platform === "win32" ? "pyrunner.exe" : "pyrunner";
const binaryPath = join(homedir, ".pyrunner", "bin", binName);

if (!existsSync(binaryPath)) {
  console.error(`[Error] PyRunner service binary not found at: ${binaryPath}`);
  console.error("Please run the installer once to initialize the service.");
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: false,
});

process.exit(result.status ?? 1);
