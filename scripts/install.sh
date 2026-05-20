#!/bin/bash
set -e

REPO="DropGuard/pyrunner"
TARGET_DIR="$HOME/.pyrunner/bin"
TEMP_DIR=$(mktemp -d "/tmp/pyrunner-install-XXXXXX")
TEMP_EXE="$TEMP_DIR/pyrunner"

echo "🚀 开始安装/更新 PyRunner..."

# 1. 自动识别平台
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [ "$OS" = "darwin" ]; then
    TARGET_PLATFORM=$([ "$ARCH" = "arm64" ] && echo "darwin-arm64" || echo "darwin-x64")
elif [ "$OS" = "linux" ]; then
    TARGET_PLATFORM="linux-x64"
else
    echo "❌ 暂不支持的操作系统: $OS"
    exit 1
fi

# 2. 获取最新 Release 下载链接
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/[^"]*' | grep "${TARGET_PLATFORM}" | head -n 1)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ 未能在最新 Release 中找到平台为 $TARGET_PLATFORM 的构建产物"
    exit 1
fi

# 3. 下载到临时目录
echo "正在下载二进制文件..."
curl -L -o "$TEMP_EXE" "$DOWNLOAD_URL"
chmod +x "$TEMP_EXE"

# 4. 配置环境变量 PATH
SHELL_NAME=$(basename "$SHELL")
RC_FILE=$([ "$SHELL_NAME" = "zsh" ] && echo "$HOME/.zshrc" || echo "$HOME/.bashrc")

if [[ ":$PATH:" != *":$TARGET_DIR:"* ]]; then
    echo "正在添加 $TARGET_DIR 到 PATH..."
    echo "export PATH=\"\$PATH:$TARGET_DIR\"" >> "$RC_FILE"
    export PATH="$PATH:$TARGET_DIR"
fi

# 5. 执行临时二进制完成自更新及启动
echo "正在安装后台服务..."
"$TEMP_EXE" install

# 6. 清理临时文件
rm -rf "$TEMP_DIR"

echo "✨ PyRunner 安装成功!"
echo "请执行 'source $RC_FILE' 重载环境变量，或在新终端中运行 'pyrunner list'。"
