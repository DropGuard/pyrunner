/**
 * Build script for platform-specific npm sub-packages.
 *
 * Usage:
 *   bun scripts/build-platform.ts <target>
 *
 * Targets: windows-x64, linux-x64, darwin-arm64, darwin-x64
 *
 * This script:
 * 1. Compiles src/cli/index.ts into a standalone binary for the target platform
 * 2. Creates a platform sub-package in platform-packages/<name>/ with the binary + package.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const target = process.argv[2];
if (!target) {
  console.error("Usage: bun scripts/build-platform.ts <target>");
  console.error("Targets: windows-x64, linux-x64, darwin-arm64, darwin-x64");
  process.exit(1);
}

const [platform, arch] = target.split("-");
if (!platform || !arch) {
  console.error(`Invalid target: ${target}. Expected format: <platform>-<arch>`);
  process.exit(1);
}

const rootDir = join(import.meta.dir, "..");
const pkgJson = await Bun.file(join(rootDir, "package.json")).json();
const version = pkgJson.version;

// Binary name
const binName = platform === "windows" ? "pyrunner.exe" : "pyrunner";

// Sub-package name
const subPkgName = `@dropguard/pyrunner-${target}`;
const subPkgDir = join(rootDir, "platform-packages", target);

console.log(`Building ${subPkgName} v${version}...`);

// 1. Clean and create output directory
mkdirSync(subPkgDir, { recursive: true });
mkdirSync(join(subPkgDir, "bin"), { recursive: true });

// 2. Compile binary
console.log(`Compiling for ${target}...`);
const outFile = join(subPkgDir, "bin", binName);

// bun build --compile --target=bun-linux-x64 ./src/cli/index.ts --outfile ...
const bunTarget = `bun-${platform}-${arch}`;
await $`bun build --compile --target=${bunTarget} ./src/cli/index.ts --outfile ${outFile}`.cwd(
  rootDir,
);

console.log(`Binary compiled: ${outFile}`);

// 3. Generate sub-package package.json
const subPkg = {
  name: subPkgName,
  version,
  description: `PyRunner binary for ${target}`,
  os: [platform === "windows" ? "win32" : platform],
  cpu: [arch === "arm64" ? "arm64" : "x64"],
  files: ["bin/"],
  license: "MIT",
};

writeFileSync(join(subPkgDir, "package.json"), `${JSON.stringify(subPkg, null, 2)}\n`);

console.log(`Sub-package created: ${subPkgDir}`);
console.log("Done.");
