#!/usr/bin/env bash
# AniHub 一键更新脚本（在服务器上运行）
# 用法：bash deploy/update.sh [remote] [branch]
#   remote 默认使用 GitHub 代理（大陆服务器直连 GitHub 不稳定）：
#   https://ghfast.top/https://github.com/CONSISTROL/anihub.git
#   也可指定已有 remote（如 gitee）：bash deploy/update.sh gitee
# 说明：.env / 数据库 / 上传图片不受影响（gitignore 已排除）
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
APP_USER="${APP_USER:-anihub}"
# GitHub 第三方代理；域名失效时替换为 gh-proxy.com / mirror.ghproxy.com 等
PROXY_URL="https://ghfast.top/https://github.com/CONSISTROL/anihub.git"
REMOTE="${1:-$PROXY_URL}"
BRANCH="${2:-master}"

# 升级进度状态（网页设置页轮询展示；服务重启后仍可读取）
UPGRADE_STATE="${UPGRADE_STATE:-$APP_DIR/.upgrade-state.json}"

write_state() {
  printf '{"state":"%s","phase":"%s","updatedAt":%s}\n' "$1" "$2" "$(date +%s)" > "$UPGRADE_STATE"
}
trap 'write_state failed error' ERR

write_state running fetch
echo "==> 拉取 $REMOTE/$BRANCH"
git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
git fetch "$REMOTE" "$BRANCH"

if git merge-base --is-ancestor HEAD FETCH_HEAD >/dev/null 2>&1 \
   && git diff --quiet && git diff --cached --quiet; then
  echo "==> 本地历史可快进且工作区干净，执行 git merge --ff-only"
  if git merge --ff-only FETCH_HEAD; then
    :
  else
    echo "==> 快进失败（可能被未跟踪文件阻塞），按远程为准强制同步"
    git clean -fd
    git reset --hard FETCH_HEAD
  fi
else
  echo "==> 本地提交记录/工作区与远程不一致，按远程为准强制同步"
  echo "    即将丢弃本地独有提交与未提交改动（.env/数据库/上传图片等 ignored 文件不受影响）"
  git clean -fd
  git reset --hard FETCH_HEAD
fi

write_state running install
echo "==> 安装依赖并构建前端"
npm ci
write_state running build
npm run build

write_state running nginx
echo "==> 同步 Nginx 反代配置（WebSocket 转发等）"
if [[ -f /etc/nginx/sites-available/anihub ]]; then
  DOMAIN="$(sed -n 's/^[[:space:]]*server_name[[:space:]]*\([^;]*\);.*/\1/p' /etc/nginx/sites-available/anihub | head -1 | xargs)"
  if [[ -n "$DOMAIN" ]]; then
    BAK="/etc/nginx/sites-available/anihub.bak.$(date +%s)"
    cp /etc/nginx/sites-available/anihub "$BAK"
    sed "s|__DOMAIN__|$DOMAIN|g" deploy/anihub.nginx.conf > /etc/nginx/sites-available/anihub
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      echo "    Nginx 配置已同步并重载（域名: $DOMAIN）"
    else
      cp "$BAK" /etc/nginx/sites-available/anihub
      echo "    ⚠ nginx -t 校验失败，已回滚到原配置（请检查 deploy/anihub.nginx.conf）"
    fi
  else
    echo "    ⚠ 未能从现有配置解析出域名，跳过 Nginx 更新（请手动检查 /etc/nginx/sites-available/anihub）"
  fi
else
  echo "    未安装 Nginx 反代（直连 3001 访问），跳过"
fi

echo "==> 更新完成"
# 以 root 跑完（控制台 sudo 提权）后，把应用目录所有权归还给运行用户，
# 否则 npm 等会因 root 拥有的文件报 EACCES
if [[ $EUID -eq 0 ]]; then
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  echo "==> 已把 $APP_DIR 所有权归还给 $APP_USER"
fi

# 重启必须放最后：本脚本是 anihub 服务的子进程（控制台里跑的），
# systemctl restart 会终止整个服务（含本脚本进程树），后面的步骤将不会执行。
write_state running restart
echo "==> 重启服务（会断开控制台连接，属正常现象，稍后自动重连）"
systemctl restart anihub
write_state done restart
echo "==> 服务已重启"
