@echo off
setlocal
cd /d "%~dp0"
title HUMAN.exe - Orbital
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if exist "dist\index.html" goto play
if exist "node_modules\vite\bin\vite.js" goto assets
echo Setting up HUMAN.exe...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto failed
:assets
call npm.cmd run assets
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
:play
node scripts\launch.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Setup did not finish. Check the message above and try again.
pause
exit /b 1
