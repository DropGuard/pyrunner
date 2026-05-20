#!/usr/bin/env node
const { spawn } = require("node:child_process");

/**
 * Main entry point for npm distribution.
 * Strictly proxies to the npm-installed platform binary.
 * This ensures CLI commands always use the version installed by npm,
 * allowing updates to work correctly before the service is restarted.
 */

const arch = process.arch === "arm64" ? "arm64" : "x64";
const os =
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
const binName = process.platform === "win32" ? "pyrunner.exe" : "pyrunner";
const pkgName = `@dropguard/pyrunner-${os}-${arch}`;

let executePath;
try {
  executePath = require.resolve(`${pkgName}/${binName}`);
} catch (e) {
  console.error(`[Error] PyRunner platform binary not found: ${pkgName}`);
  console.error("Please ensure the platform-specific optional dependency was installed.");
  process.exit(1);
}

const proc = spawn(executePath, process.argv.slice(2), {
  stdio: "inherit",
});

proc.on("exit", (code) => {
  process.exit(code ?? 1);
});
