@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - Tum Degisiklikleri Push

set "ROOT=%~dp0.."
cd /d "%ROOT%"

where git >nul 2>&1
if errorlevel 1 (
    echo HATA: Git bulunamadi.
    pause
    exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" (
    echo HATA: Bu klasor bir git reposu degil.
    pause
    exit /b 1
)

git status --short
echo.
git add -A
git diff --cached --quiet
if not errorlevel 1 (
    echo Commit edilecek degisiklik yok.
    pause
    exit /b 0
)

set "COMMIT_MSG="
set /p COMMIT_MSG=Commit mesaji (bos birakirsan varsayilan kullanilir): 
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=chore: tum degisiklikleri guncelle"

git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo HATA: Commit basarisiz.
    pause
    exit /b 1
)

git push origin %BRANCH%
if errorlevel 1 (
    echo HATA: Push basarisiz.
    pause
    exit /b 1
)

echo Basarili: GitHub'a push tamamlandi.
pause