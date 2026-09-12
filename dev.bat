@echo off
rem AniHub 本地一键启动：同时启动后端 API 与前端 Vite dev
cd /d "%~dp0"
pnpm run dev:all
