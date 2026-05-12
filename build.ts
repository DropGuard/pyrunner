// build.ts

import { existsSync, unlinkSync } from "node:fs";
import { $ } from "bun";

console.log("🚀 Starting build...");

try {
  // Delete old files first to avoid confusion
  if (existsSync("pyrunner.exe")) unlinkSync("pyrunner.exe");
  if (existsSync("cli.exe")) unlinkSync("cli.exe");

  const result = await $`bun build --compile ./src/cli/index.ts --outfile pyrunner.exe`.quiet();

  if (result.exitCode === 0) {
    console.log("✅ Build successful: pyrunner.exe");
  } else {
    console.error("❌ Build failed:", result.stderr.toString());
    process.exit(1);
  }
} catch (e) {
  console.error("❌ Build error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
