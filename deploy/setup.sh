#!/usr/bin/env bash
# AniHub 一键部署脚本（Ubuntu 22.04 / 24.04，国内轻量服务器）
#
# 用法（在服务器上，root 或 sudo）：
#   sudo DOMAIN=anime.example.com CERT_EMAIL=you@example.com bash deploy/setup.sh
# 可选环境变量：
#   DOMAIN          域名（留空则跳过 Nginx/HTTPS，仅用 http://IP:3001 访问，生产不建议）
#   CERT_EMAIL      Let's Encrypt 证书邮箱（配 DOMAIN 时必填）
#   APP_DIR         应用目录，默认 /opt/anihub
#   APP_USER        运行用户，默认 anihub
#   REPO_URL        git 仓库地址（默认走 GitHub 代理，大陆服务器可直接拉取）
#   ADMIN_USERNAME  管理员用户名，默认 admin
#   ADMIN_PASSWORD  管理员密码（留空则自动生成并打印，注意保存）
#   INSIDER_KEYWORD 内部人员口令，默认 inside
#   BACKUP_DIR      备份目录，默认 /opt/anihub-backups
set -euo pipefail

DOMAIN="${DOMAIN:-}"
CERT_EMAIL="${CERT_EMAIL:-}"
APP_DIR="${APP_DIR:-/opt/anihub}"
APP_USER="${APP_USER:-anihub}"
# GitHub 第三方代理（大陆直连 GitHub 不稳定）；域名失效时替换为 gh-proxy.com / mirror.ghproxy.com 等
REPO_URL="${REPO_URL:-https://ghfast.top/https://github.com/CONSISTROL/anihub.git}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
INSIDER_KEYWORD="${INSIDER_KEYWORD:-inside}"
BACKUP_DIR="${BACKUP_DIR:-/opt/anihub-backups}"

if [[ $EUID -ne 0 ]]; then
  echo "错误：请用 root 或 sudo 运行" >&2
  exit 1
fi
if [[ -n "$DOMAIN" && -z "$CERT_EMAIL" ]]; then
  echo "错误：设置 DOMAIN 时必须同时设置 CERT_EMAIL（Let's Encrypt 需要）" >&2
  exit 1
fi

echo "==> [1/8] 安装系统依赖（nginx / git / curl / sqlite3）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx git curl ca-certificates gnupg sqlite3

echo "==> [2/8] 安装 Node.js 24（NodeSource，node:sqlite 需 Node 24）"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "==> [3/8] 创建运行用户 $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> [4/8] 准备应用代码 $APP_DIR"
if [[ ! -f "$APP_DIR/package.json" ]]; then
  if [[ -n "$REPO_URL" ]]; then
    # GitHub 国内不稳定，clone 加超时，失败即中止并提示
    timeout 90 git clone "$REPO_URL" "$APP_DIR" || {
      echo "错误：git clone 超时/失败（GitHub 网络问题）。" >&2
      echo "      可改用：把代码直接上传到 $APP_DIR，或设置 REPO_URL 指向 Gitee 镜像。" >&2
      exit 1
    }
  else
    mkdir -p "$APP_DIR"
    echo "错误：$APP_DIR 里没有代码。" >&2
    echo "      请二选一：" >&2
    echo "      1) 设置 REPO_URL 让脚本自动 clone（推荐，配合 git push 更新）" >&2
    echo "      2) 先把项目文件上传到 $APP_DIR（scp -r . root@服务器:/opt/anihub/）" >&2
    exit 1
  fi
fi
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true
# 拉取更新：走 REPO_URL（默认 GitHub 代理），加超时防止卡死；失败不阻断（继续用已有代码构建）
if timeout 30 git pull "$REPO_URL" master 2>&1 | tail -3; then
  :
else
  echo "    git pull 超时/失败（网络问题），继续使用本地已有代码"
fi
npm ci
npm run build

echo "==> [5/8] 生成 server/.env（密钥随机生成，不重复覆盖）"
mkdir -p "$APP_DIR/server"
if [[ ! -f "$APP_DIR/server/.env" ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(openssl rand -hex 8)"
    GENERATED_PW=1
  fi
  cat > "$APP_DIR/server/.env" <<EOF
JWT_SECRET=$JWT_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
INSIDER_KEYWORD=$INSIDER_KEYWORD
EOF
  chown "$APP_USER":"$APP_USER" "$APP_DIR/server/.env"
  echo "    已生成 server/.env"
  if [[ -n "${GENERATED_PW:-}" ]]; then
    echo "    ⚠ 管理员账号: $ADMIN_USERNAME  密码: $ADMIN_PASSWORD（请立即保存，之后可在 .env 修改）"
  fi
else
  echo "    server/.env 已存在，跳过（如需改管理员密码/口令请直接编辑该文件）"
fi

echo "==> [6/8] 安装 systemd 服务并启动"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
  "$APP_DIR/deploy/anihub.service" > /etc/systemd/system/anihub.service
systemctl daemon-reload
systemctl enable anihub
systemctl restart anihub
sleep 1
systemctl --no-pager --lines=15 status anihub || true

echo "==> [7/8] 配置防火墙（仅 SSH/HTTP/HTTPS）"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo "==> [8/8] 配置 Nginx + HTTPS（域名: ${DOMAIN:-未设置}）"
if [[ -n "$DOMAIN" ]]; then
  sed "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/anihub.nginx.conf" > /etc/nginx/sites-available/anihub
  ln -sf /etc/nginx/sites-available/anihub /etc/nginx/sites-enabled/anihub
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$CERT_EMAIL" --agree-tos --non-interactive --redirect || {
    echo "    ⚠ certbot 自动签发失败，请手动执行：sudo certbot --nginx -d $DOMAIN"
  }
else
  echo "    未设置 DOMAIN，跳过 HTTPS。当前可通过 http://服务器IP:3001 访问（生产环境请务必配置域名 + HTTPS）"
fi

echo "==> 配置每日备份（03:00，保留最近 14 份）"
mkdir -p "$BACKUP_DIR"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" \
  "$APP_DIR/deploy/backup.sh" > /usr/local/bin/anihub-backup
chmod +x /usr/local/bin/anihub-backup
echo "0 3 * * * root /usr/local/bin/anihub-backup >> /var/log/anihub-backup.log 2>&1" > /etc/cron.d/anihub-backup
/usr/local/bin/anihub-backup

echo
echo "================== 部署完成 =================="
if [[ -n "$DOMAIN" ]]; then
  echo "访问地址: https://$DOMAIN"
else
  echo "访问地址: http://<服务器IP>:3001"
fi
echo "登录: 页面敲键盘 login → 输入 server/.env 中的 ADMIN_USERNAME / ADMIN_PASSWORD"
echo "更新代码: cd $APP_DIR && git pull && npm ci && npm run build && sudo systemctl restart anihub"
echo "数据备份: $BACKUP_DIR（每日 03:00 自动执行，也可手动运行 /usr/local/bin/anihub-backup）"
