# PyRunner Windows 免安装一键安装/更新脚本
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "DropGuard/pyrunner"
$TargetDir = "$Home\.pyrunner\bin"
$TempDir = "$env:TEMP\pyrunner-install-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -Path $TempDir -ItemType Directory -Force | Out-Null
$TempExe = "$TempDir\pyrunner.exe"

Write-Host "🚀 开始安装/更新 PyRunner..." -ForegroundColor Cyan

# 1. 获取最新 Release 的下载链接
try {
    $ApiUri = "https://api.github.com/repos/$Repo/releases/latest"
    $Release = Invoke-RestMethod -Uri $ApiUri -UseBasicParsing
    $Asset = $Release.assets | Where-Object { $_.name -like "*windows-x64.exe" }
    if (-not $Asset) { throw "未能在 Release 中找到 windows-x64.exe" }
    $DownloadUrl = $Asset.browser_download_url
    Write-Host "发现最新版本: $($Release.tag_name)" -ForegroundColor Green
} catch {
    Write-Error "获取 GitHub 最新版本失败: $_"
    exit 1
}

# 2. 下载到系统 TEMP 目录（避开正在运行的守护进程文件锁）
Write-Host "正在下载 PyRunner 二进制文件..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempExe -UseBasicParsing
} catch {
    Write-Error "下载失败: $_"
    exit 1
}

# 3. 将目标目录加到用户 PATH 中（如果不存在）
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -split ";" -notcontains $TargetDir) {
    Write-Host "正在添加 $TargetDir 到 User PATH..." -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$TargetDir", "User")
    $env:Path += ";$TargetDir"
}

# 4. 执行临时文件，由二进制自身接管服务安装、文件覆盖（Rename-trick）和启动
Write-Host "正在安装后台服务..." -ForegroundColor Cyan
try {
    Start-Process -FilePath $TempExe -ArgumentList "install" -NoNewWindow -Wait
} catch {
    Write-Error "服务安装失败: $_"
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# 5. 清理临时下载文件
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "✨ PyRunner 安装成功!" -ForegroundColor Green
Write-Host "请在新终端输入 'pyrunner list' 开始使用。" -ForegroundColor Cyan
