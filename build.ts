// build.ts
import { $ } from "bun";
import { unlinkSync, existsSync } from "node:fs";

console.log("🚀 Starting build...");

try {
  // Delete old files first to avoid confusion
  if (existsSync("pyrunner.exe")) unlinkSync("pyrunner.exe");
  if (existsSync("cli.exe")) unlinkSync("cli.exe");

  const result = await $`bun build --compile ./src/cli.ts --outfile pyrunner.exe`.quiet();

  if (result.exitCode === 0) {
    console.log("✅ Build successful: pyrunner.exe");
  } else {
    console.error("❌ Build failed:", result.stderr.toString());
    process.exit(1);
  }
} catch (e: any) {
  console.error("❌ Build error:", e.message);
  process.exit(1);
}
