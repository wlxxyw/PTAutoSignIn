#!/bin/sh
echo "> js脚本环境初始化"
set -e  # 遇到错误立即退出，保证可靠性

echo ">>> 使用阿里云软件源"
sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

echo ">>> 安装 bash"
apk add --no-cache bash

echo ">>> 安装 Node.js 和 npm"
apk add --no-cache nodejs npm

echo ">>> 设置 npm 镜像为淘宝源"
npm config set registry https://registry.npmmirror.com

echo ">>> 安装 依赖包"
[ -d "/app" ] || continue
if [ -f "/app/package.json" ]; then
    echo "发现/app/packages.json"
    if [ ! -d "/app/node_modules" ]; then
        (
            cd "/app" || exit 1
            echo "安装/app依赖"
            npm install
        )
    fi
fi
