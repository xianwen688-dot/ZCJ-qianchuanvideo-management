@echo off
cd /d D:\douyin-video-dashboard
echo ==============================
echo 抖音视频投放管理系统
echo ==============================
echo.
echo Starting server...
call npx tsx server/index.ts
pause
