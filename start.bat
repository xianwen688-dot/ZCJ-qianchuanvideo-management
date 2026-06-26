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
    echo [*] 添加防火墙规则 (端口 8788)...
    netsh advfirewall firewall add rule name="抖音视频投放管理" dir=in action=allow protocol=TCP localport=8788 >nul 2>&1
    echo [*] 防火墙规则已添加
) else (
    echo [*] 防火墙规则已存在
)

echo [*] 启动服务器...
echo.
echo   本地访问: http://localhost:8788
echo   局域网:   http://%COMPUTERNAME%:8788
echo.

REM 加载.env环境变量
if exist .env for /f "tokens=1,2 delims==" %%a in (.env) do set %%a=%%b

call npx tsx server/index.ts
pause
