#!/usr/bin/env node

/**
 * PyRunner npm wrapper — downloads the platform-specific Go binary on first run.
 * This file is the npm "bin" entry point. It detects the platform, downloads
 * the correct binary from GitHub Releases, and forwards arguments to it.
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const VERSION = require("./package.json").version;
const BASE_URL = `https://github.com/DropGuard/pyrunner/releases/download/v${VERSION}`;
const INSTALL_DIR = path.join(os.homedir(), ".pyrunner", "bin");

function getPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMap = { win32: "windows", linux: "linux", darwin: "darwin" };
  const archMap = { x64: "amd64", arm64: "arm64" };

  const p = platformMap[platform];
  const a = archMap[arch];

  if (!p || !a) {
    console.error(`Unsupported platform: ${platform}-${arch}`);
    process.exit(1);
  }

  return { platform: p, arch: a };
}

function getBinaryName(platform) {
  return platform === "windows" ? "pyrunner.exe" : "pyrunner";
}

function getDaemonName(platform) {
  return platform === "windows" ? "pyrunnerd.exe" : "pyrunnerd";
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const request = (redirectUrl) => {
      https.get(redirectUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }).on("error", reject);
    };

    request(url);
  });
}

async function ensureBinaries() {
  const { platform, arch } = getPlatform();
  const cliName = getBinaryName(platform);
  const daemonName = getDaemonName(platform);

  const cliPath = path.join(INSTALL_DIR, cliName);
  const daemonPath = path.join(INSTALL_DIR, daemonName);

  if (fs.existsSync(cliPath) && fs.existsSync(daemonPath)) {
    return { cliPath, daemonPath };
  }

  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  const ext = platform === "windows" ? "zip" : "tar.gz";
  const archiveName = `pyrunner-v${VERSION}-${platform}-${arch}.${ext}`;
  const archiveUrl = `${BASE_URL}/${archiveName}`;
  const archivePath = path.join(os.tmpdir(), archiveName);

  console.log(`Downloading PyRunner v${VERSION} for ${platform}-${arch}...`);

  try {
    await download(archiveUrl, archivePath);
  } catch (e) {
    console.error(`Failed to download: ${e.message}`);
    console.error(`URL: ${archiveUrl}`);
    process.exit(1);
  }

  // Extract
  if (platform === "windows") {
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${INSTALL_DIR}' -Force"`);
  } else {
    execSync(`tar xzf "${archivePath}" -C "${INSTALL_DIR}"`);
  }

  // Make executable on Unix
  if (platform !== "windows") {
    fs.chmodSync(cliPath, 0o755);
    fs.chmodSync(daemonPath, 0o755);
  }

  // Cleanup
  fs.unlinkSync(archivePath);

  return { cliPath, daemonPath };
}

async function main() {
  const { cliPath } = await ensureBinaries();
  const args = process.argv.slice(2);

  const result = spawnSync(cliPath, args, {
    stdio: "inherit",
    windowsHide: false,
  });

  process.exit(result.status || 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
