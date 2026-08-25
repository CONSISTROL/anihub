#!/usr/bin/env bash
# AniHub 一键更新脚本（在服务器上运行）
# 用法：bash deploy/update.sh [remote] [branch]
#   remote 默认使用 GitHub 代理（大陆服务器直连 GitHub 不稳定）：
#   https://ghfast.top/https://github.com/CONSISTROL/anihub.git
#   也可指定已有 remote（如 gitee）：bash deploy/update.sh gitee
# 说明：.env / 数据库 / 上传图片不受影响（gitignore 已排除）
set -euo pipefail

cd "$(dirname "$0")/.."
# GitHub 第三方代理；域名失效时替换为 gh-proxy.com / mirror.ghproxy.com 等
PROXY_URL="https://ghfast.top/https://github.com/CONSISTROL/anihub.git"
REMOTE="${1:-$PROXY_URL}"
BRANCH="${2:-master}"

echo "==> 拉取 $REMOTE/$BRANCH"
git fetch "$REMOTE" "$BRANCH"
git merge --ff-only FETCH_HEAD

echo "==> 安装依赖并构建前端"
npm ci
npm run build

echo "==> 重启服务"
systemctl restart anihub

echo "==> 更新完成"
