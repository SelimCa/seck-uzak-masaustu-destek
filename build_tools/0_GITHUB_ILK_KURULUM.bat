@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - GitHub Ilk Kurulum

set "ROOT=%~dp0.."
cd /d "%ROOT%"

where git >nul 2>&1
if errorlevel 1 (
    echo HATA: Git bulunamadi.
    pause
    exit /b 1
)

where gh >nul 2>&1
if errorlevel 1 (
    echo HATA: GitHub CLI bulunamadi. Kurulum: winget install --id GitHub.cli
    pause
    exit /b 1
)

gh auth status >nul 2>&1
if errorlevel 1 (
    echo GitHub girisi gerekli...
    gh auth login --git-protocol https
    if errorlevel 1 (
        echo HATA: GitHub girisi yapilamadi.
        pause
        exit /b 1
    )
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'version.json' -Raw | ConvertFrom-Json).githubRepo"`) do set "GITHUB_REPO=%%i"
if "%GITHUB_REPO%"=="" (
    echo HATA: version.json icinde githubRepo bos.
    pause
    exit /b 1
)

if not exist ".git" (
    git init -b main
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    gh repo create "%GITHUB_REPO%" --public --source=. --remote=origin
    if errorlevel 1 (
        echo HATA: GitHub repo olusturulamadi.
        pause
        exit /b 1
    )
)

git add .
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Ilk surum altyapisi"
)

git push -u origin main
if errorlevel 1 (
    echo HATA: GitHub push basarisiz.
    pause
    exit /b 1
)

echo Basarili: GitHub repo hazir.
gh repo view --web
pause