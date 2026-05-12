#!/usr/bin/env node

/**
 * Main entry point for npm distribution.
 *
 * Detects the current platform and spawns the corresponding
 * compiled binary from the platform-specific sub-package.
 */

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, dirname } = require("node:path");

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = `${platform}-${arch}`;

const pkgName = `@dropguard/pyrunner-${target}`;
const binName = process.platform === "win32" ? "pyrunner.exe" : "pyrunner";

const homedir = require("node:os").homedir();
const installedBinPath = join(homedir, ".pyrunner", "bin", binName);

function findBinary() {
  // Strategy 1: Prefer the locally installed 'service' version if available
  // This allows 'pyrunner install' to perform self-upgrades.
  if (existsSync(installedBinPath)) return installedBinPath;

  // Strategy 2: Standard npm resolution
  try {
    const pkgDir = require.resolve(`${pkgName}/package.json`);
    const binPath = join(dirname(pkgDir), "bin", binName);
    if (existsSync(binPath)) return binPath;
  } catch {}

  // Strategy 3: Flat node_modules (pnpm, hoisted)
  const flatPath = join(__dirname, "..", pkgName, "bin", binName);
  if (existsSync(flatPath)) return flatPath;

  return null;
}

const binaryPath = findBinary();
if (!binaryPath) {
  console.error(`Error: Platform binary not found for ${target}.`);
  console.error(`Expected package: ${pkgName}`);
  console.error(`Run: npm install -g @dropguard/pyrunner`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: false,
});

process.exit(result.status ?? 1);
