import { basename } from "node:path";
import pkg from "@/../package.json" with { type: "json" };
import { getBinaryName, getPlatformTarget } from "@/utils/paths";
import { getExecutablePath } from "@/utils/process";

/**
 * Attempts to locate the compiled platform-specific binary.
 * Checks in order of logical certainty: Standalone execution -> Package-based resolution
 *
 * In development, 'scripts/build.ts' links the built platform package into 'node_modules',
 * allowing the same resolution logic to work for both dev and prod.
 */
export async function resolveServiceBinary(): Promise<string | null> {
  const { execPath } = getExecutablePath();

  // Priority 1: Are we running as the compiled standalone binary?
  if (await isStandalonePath(execPath)) {
    return execPath;
  }

  // Priority 2: Resolve via package-based resolution (Works for both NPM Global and Local Dev)
  const pkgBinary = await resolvePackageBinary();
  if (pkgBinary) return pkgBinary;

  return null;
}

async function isStandalonePath(execPath: string): Promise<boolean> {
  if (!execPath) return false;

  const base = basename(execPath).toLowerCase();
  const expectedName = getBinaryName().toLowerCase();

  return base === expectedName && (await Bun.file(execPath).exists());
}

async function resolvePackageBinary(): Promise<string | null> {
  const target = getPlatformTarget();
  const pkgName = `${pkg.name}-${target}`;
  const binName = getBinaryName();

  try {
    return Bun.resolveSync(`${pkgName}/${binName}`, import.meta.dir);
  } catch {
    return null;
  }
}
