@echo off
chcp 65001 > nul
title Seck Uzak Masaustu Destek - Guncelleme Yayinla

set "ROOT=%~dp0.."
cd /d "%ROOT%"

where gh >nul 2>&1
if errorlevel 1 (
    echo HATA: GitHub CLI bulunamadi.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'version.json' -Raw | ConvertFrom-Json).appVersion"`) do set "APP_VERSION=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'version.json' -Raw | ConvertFrom-Json).githubRepo"`) do set "GITHUB_REPO=%%i"

if "%APP_VERSION%"=="" (
    echo HATA: Surum okunamadi.
    pause
    exit /b 1
)

if "%GITHUB_REPO%"=="" (
    echo HATA: githubRepo okunamadi.
    pause
    exit /b 1
)

set "INSTALLER=%ROOT%\dist\Seck.Uzak.Masaustu.Destek.Setup.%APP_VERSION%.exe"
set "BLOCKMAP=%INSTALLER%.blockmap"
set "LATEST=%ROOT%\dist\latest.yml"

if not exist "%INSTALLER%" (
    call "%~dp01_EXE_OLUSTUR.bat"
)

if not exist "%INSTALLER%" (
    echo HATA: Installer olusmadi.
    pause
    exit /b 1
)

if not exist "%LATEST%" (
    echo HATA: latest.yml bulunamadi.
    pause
    exit /b 1
)

git add .
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: release v%APP_VERSION%"
)

git push origin main

gh release view "v%APP_VERSION%" --repo "%GITHUB_REPO%" >nul 2>&1
if errorlevel 1 (
    gh release create "v%APP_VERSION%" "%INSTALLER%" "%BLOCKMAP%" "%LATEST%" --repo "%GITHUB_REPO%" --title "v%APP_VERSION%" --notes "Surum v%APP_VERSION%"
) else (
    gh release upload "v%APP_VERSION%" "%INSTALLER%" "%BLOCKMAP%" "%LATEST%" --repo "%GITHUB_REPO%" --clobber
)

if errorlevel 1 (
    echo HATA: Release yayinlanamadi.
    pause
    exit /b 1
)

echo Basarili: Guncelleme yayinlandi.
gh release view "v%APP_VERSION%" --repo "%GITHUB_REPO%" --web
pause