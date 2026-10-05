@echo off
chcp 65001 >nul
setlocal

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "EXE_NAME=circinus-ad-astra.exe"
set "SOURCE_EXE=%PROJECT_DIR%\src-tauri\target\release\%EXE_NAME%"

echo ============================================
echo   Circinus ad Astra Build Script
echo ============================================
echo.

if not exist "%PROJECT_DIR%\package.json" (
    echo [ERROR] package.json not found. Run from project root.
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%\src-tauri\Cargo.toml" (
    echo [ERROR] src-tauri\Cargo.toml not found.
    pause
    exit /b 1
)

echo [1/4] Stopping running Circinus ad Astra processes...
taskkill /f /im circinus-ad-astra.exe >nul 2>&1
echo   [OK] Cleared.

echo.
if exist "%PROJECT_DIR%\dist" (
    echo [2/4] Cleaning frontend output...
    rmdir /s /q "%PROJECT_DIR%\dist"
)

echo [3/4] Building Tauri executable without installer bundle...
call npm --prefix "%PROJECT_DIR%" run tauri -- build --no-bundle
if errorlevel 1 (
    echo [ERROR] Tauri build failed.
    pause
    exit /b 1
)

echo.
echo [4/4] Done. No installer package was generated and no release copy was created.
echo   [OK] %SOURCE_EXE%

echo.
echo ============================================
echo   Build complete!
echo ============================================
echo.
