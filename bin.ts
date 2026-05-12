#!/usr/bin/env node

/**
 * Main entry point for npm distribution.
 *
 * Detects the current platform and spawns the corresponding
 * compiled binary from the platform-specific sub-package.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = `${platform}-${arch}`;

const pkgName = `@dropguard/pyrunner-${target}`;
const binName = process.platform === "win32" ? "pyrunner.exe" : "pyrunner";

// Try to find the binary in the platform sub-package
function findBinary(): string | null {
  // Standard npm resolution
  try {
    const pkgDir = require.resolve(`${pkgName}/package.json`);
    const binPath = join(dirname(pkgDir), "bin", binName);
    if (existsSync(binPath)) return binPath;
  } catch {}

  // Flat node_modules (pnpm, some npm versions)
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
