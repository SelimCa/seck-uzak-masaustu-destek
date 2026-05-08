@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - Calistir

set "ROOT=%~dp0"
cd /d "%ROOT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo HATA: npm bulunamadi. Once Node.js kurun: https://nodejs.org/
    pause
    exit /b 1
)

cmd /c npm start
pause