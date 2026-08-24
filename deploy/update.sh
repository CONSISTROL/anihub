#!/usr/bin/env bash
# AniHub 一键更新脚本（在服务器上运行）
# 用法：sudo bash deploy/update.sh [remote] [branch]
#   remote 默认 origin（GitHub），大陆服务器连不上时可指定 gitee：
#   sudo bash deploy/update.sh gitee
# 说明：.env / 数据库 / 上传图片不受影响（gitignore 已排除）
set -euo pipefail

cd "$(dirname "$0")/.."
REMOTE="${1:-origin}"
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
