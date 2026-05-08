@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - EXE Olustur

set "ROOT=%~dp0.."
cd /d "%ROOT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo HATA: npm bulunamadi.
    pause
    exit /b 1
)

echo [1/2] Bagimliliklar kontrol ediliyor...
cmd /c npm install
if errorlevel 1 (
    echo HATA: npm install basarisiz.
    pause
    exit /b 1
)

echo [2/2] Kurulum EXE'si olusturuluyor...
cmd /c npm run build-win
if errorlevel 1 (
    echo HATA: build-win basarisiz.
    pause
    exit /b 1
)

explorer "%ROOT%\dist"
pause