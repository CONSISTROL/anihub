#!/usr/bin/env bash
# AniHub 数据备份：SQLite 数据库 + 上传图片，打包到 BACKUP_DIR，本地保留最近 KEEP 份
# 由 deploy/setup.sh 安装到 /usr/local/bin/anihub-backup（占位符被替换）
set -euo pipefail

APP_DIR="__APP_DIR__"
BACKUP_DIR="__BACKUP_DIR__"
KEEP="${KEEP:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# WAL 模式下先做 checkpoint，保证打包出来的数据库文件一致（sqlite3 未安装则跳过）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$APP_DIR/server/anihub.db" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null 2>&1 || true
fi

TARBALL="$BACKUP_DIR/anihub-$STAMP.tar.gz"
tar -czf "$TARBALL" -C "$APP_DIR/server" anihub.db anihub.db-wal anihub.db-shm uploads 2>/dev/null || true

# 只保留最近 KEEP 份
ls -1t "$BACKUP_DIR"/anihub-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "backup done: $TARBALL (kept latest $KEEP)"
