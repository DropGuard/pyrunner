/**
 * Normalizes process.platform and process.arch to pyrunner target strings.
 * e.g., "windows-x64", "linux-x64", "darwin-arm64"
 */
export function getPlatformTarget(): string {
  const os =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

/**
 * Returns the platform-specific binary name.
 */
export function getBinaryName(platform: string = process.platform): string {
  return platform === "win32" || platform === "windows" ? "pyrunner.exe" : "pyrunner";
}
