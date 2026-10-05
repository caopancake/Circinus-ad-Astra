$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ProjectDir = $PSScriptRoot
$ExeName = "circinus-ad-astra.exe"
$SourceExe = Join-Path $ProjectDir "src-tauri\target\release\$ExeName"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Circinus ad Astra Build Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path (Join-Path $ProjectDir "package.json"))) {
    Write-Host "[ERROR] package.json not found." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $ProjectDir "src-tauri\Cargo.toml"))) {
    Write-Host "[ERROR] src-tauri\Cargo.toml not found." -ForegroundColor Red
    exit 1
}

Write-Host "[1/4] Stopping running Circinus ad Astra processes..." -ForegroundColor Yellow
Get-Process -Name "circinus-ad-astra" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  [OK] Cleared." -ForegroundColor Green

Write-Host ""
$DistDir = Join-Path $ProjectDir "dist"
if (Test-Path $DistDir) {
    Write-Host "[2/4] Cleaning frontend output..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $DistDir -Recurse -Force
}

Write-Host "[3/4] Building Tauri executable without installer bundle..." -ForegroundColor Yellow
npm --prefix $ProjectDir run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Tauri build failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[4/4] Done. No installer package was generated and no release copy was created." -ForegroundColor Yellow
Write-Host "  [OK] $SourceExe" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Build complete!" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
