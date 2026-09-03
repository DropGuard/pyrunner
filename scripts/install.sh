#!/bin/bash
set -e

REPO="DropGuard/pyrunner"
TARGET_DIR="$HOME/.pyrunner/bin"
TEMP_DIR=$(mktemp -d "/tmp/pyrunner-install-XXXXXX")
TEMP_EXE="$TEMP_DIR/pyrunner"

echo "🚀 开始安装/更新 PyRunner..."

# 1. 自动识别平台。仓库产物按 GOOS-GOARCH 命名(amd64/x64 与 arm64)，
#    与 .github/workflows/ci.yml 的发布矩阵保持一致。
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS-$ARCH" in
    linux-x86_64)  TARGET_PLATFORM="linux-amd64" ;;
    linux-amd64)   TARGET_PLATFORM="linux-amd64" ;;
    linux-aarch64) TARGET_PLATFORM="linux-arm64" ;;
    linux-arm64)   TARGET_PLATFORM="linux-arm64" ;;
    darwin-arm64)  TARGET_PLATFORM="darwin-arm64" ;;
    *)
        echo "❌ 暂不支持的系统/架构: $OS/$ARCH"
        exit 1
        ;;
esac

# 2. 获取最新 Release 下载链接。用 python3 解析 GitHub API 返回的 JSON
#    (grep/sed 解析脆弱：资产顺序变化或字段含转义就会静默失败)。
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")

if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ 需要 python3 解析 Release 信息；请安装 python3，或从 https://github.com/$REPO/releases/latest 手动下载 ${TARGET_PLATFORM} 资产"
    exit 1
fi

if ! OUT=$(RELEASE_JSON="$RELEASE_JSON" python3 - "$TARGET_PLATFORM" <<'PY'
import json, os, re, sys

plat = sys.argv[1]
release = json.loads(os.environ["RELEASE_JSON"])
pattern = re.compile(r"^pyrunner-v[^ ]*-" + re.escape(plat) + r"\.tar\.gz$")
for asset in release.get("assets", []):
    if pattern.match(asset.get("name", "")):
        print(asset["name"])
        print(asset["browser_download_url"])
        sys.exit(0)
sys.exit(1)
PY
); then
    echo "❌ 未能在最新 Release 中找到平台为 $TARGET_PLATFORM 的构建产物"
    exit 1
fi

ARCHIVE_NAME=$(printf '%s\n' "$OUT" | sed -n '1p')
DOWNLOAD_URL=$(printf '%s\n' "$OUT" | sed -n '2p')

# 3. 下载并解压到临时目录
echo "正在下载 $ARCHIVE_NAME ..."
TEMP_ARCHIVE="$TEMP_DIR/$ARCHIVE_NAME"
curl -fL -o "$TEMP_ARCHIVE" "$DOWNLOAD_URL"
tar xzf "$TEMP_ARCHIVE" -C "$TEMP_DIR"
chmod +x "$TEMP_EXE"

# 4. 配置环境变量 PATH
SHELL_NAME=$(basename "$SHELL")
RC_FILE=$([ "$SHELL_NAME" = "zsh" ] && echo "$HOME/.zshrc" || echo "$HOME/.bashrc")

if [[ ":$PATH:" != *":$TARGET_DIR:"* ]]; then
    echo "正在添加 $TARGET_DIR 到 PATH..."
    echo "export PATH=\"\$PATH:$TARGET_DIR\"" >> "$RC_FILE"
    export PATH="$PATH:$TARGET_DIR"
fi

# 5. 执行临时二进制完成安装及启动
echo "正在安装后台服务..."
"$TEMP_EXE" install

# 6. 清理临时文件
rm -rf "$TEMP_DIR"

echo "✨ PyRunner 安装成功!"
echo "请执行 'source $RC_FILE' 重载环境变量，或在新终端中运行 'pyrunner list'。"
