@echo off
title 抖音视频投放管理系统
cd /d %~dp0

echo ==============================
echo  抖音视频投放管理系统 v1.0
echo ==============================
echo.

REM 检查并添加防火墙规则
netsh advfirewall firewall show rule name="抖音视频投放管理" >nul 2>&1
if errorlevel 1 (
    echo [*] 添加防火墙规则 (端口 8787)...
    netsh advfirewall firewall add rule name="抖音视频投放管理" dir=in action=allow protocol=TCP localport=8787 >nul 2>&1
    echo [*] 防火墙规则已添加
) else (
    echo [*] 防火墙规则已存在
)

echo [*] 启动服务器...
echo.
echo   本地访问: http://localhost:8787
echo   局域网:   http://%COMPUTERNAME%:8787
echo.

call npx tsx server/index.ts
pause
