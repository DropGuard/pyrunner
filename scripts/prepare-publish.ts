/**
 * Generates a publish-ready package.json with optionalDependencies
 * version-matched to the current version.
 *
 * Usage: bun scripts/prepare-publish.ts
 * Output: dist-publish/package.json
 */

import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

const targets = ["windows-x64", "linux-x64", "darwin-arm64", "darwin-x64"];

pkg.optionalDependencies = {};
for (const t of targets) {
  pkg.optionalDependencies[`@dropguard/pyrunner-${t}`] = pkg.version;
}

const outDir = join(rootDir, "dist-publish");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
cpSync(join(rootDir, "bin.js"), join(outDir, "bin.js"));

console.log(`Prepared dist-publish/package.json v${pkg.version}`);
console.log("optionalDependencies:", pkg.optionalDependencies);
