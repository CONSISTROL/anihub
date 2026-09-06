#!/usr/bin/env bash
# AniHub 本地一键启动：同时启动后端 API 与前端 Vite dev
set -e
cd "$(dirname "$0")"
npm run dev:all
