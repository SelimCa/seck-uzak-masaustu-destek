@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - Kur ve Calistir

set "ROOT=%~dp0"
cd /d "%ROOT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo HATA: npm bulunamadi. Once Node.js kurun: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/2] Bagimliliklar yukleniyor...
cmd /c npm install
if errorlevel 1 (
    echo HATA: npm install basarisiz.
    pause
    exit /b 1
)

echo [2/2] Uygulama baslatiliyor...
cmd /c npm start
pause