# Build script for Pure-Rust WebP SIMD & Scalar WASM Modules
# Generates webp_engine_scalar.wasm and webp_engine_simd.wasm optimized with wasm-opt

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = (Resolve-Path "$ScriptDir/..").Path
Set-Location $WorkspaceRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Building Pure-Rust WebP WASM Engine (Scalar & SIMD128)   " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$OutDir = Join-Path $WorkspaceRoot "web/public/wasm"
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$RawTarget = Join-Path $WorkspaceRoot "target/wasm32-unknown-unknown/release/webp_engine.wasm"
$ScalarOut = Join-Path $OutDir "webp_engine_scalar.wasm"
$SimdOut   = Join-Path $OutDir "webp_engine_simd.wasm"

$OriginalRustflags = $env:RUSTFLAGS

try {
    # -------------------------------------------------------------
    # 1. Build Scalar WASM Module
    # -------------------------------------------------------------
    Write-Host "`n[1/4] Compiling Scalar WebP WASM Module..." -ForegroundColor Yellow
    $env:RUSTFLAGS = "-C link-arg=--initial-memory=67108864 -C strip=symbols -C panic=abort"
    cargo build --target wasm32-unknown-unknown --release
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to compile scalar WebP WASM module"
    }

    Write-Host "[2/4] Optimizing Scalar WASM with wasm-opt -Oz..." -ForegroundColor Yellow
    pnpm dlx wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int "$RawTarget" -o "$ScalarOut"
    if ($LASTEXITCODE -ne 0) {
        throw "wasm-opt failed on scalar module"
    }

    # -------------------------------------------------------------
    # 2. Build SIMD128 WASM Module
    # -------------------------------------------------------------
    Write-Host "`n[3/4] Compiling SIMD128 WebP WASM Module (+simd128)..." -ForegroundColor Yellow
    $env:RUSTFLAGS = "-C target-feature=+simd128 -C link-arg=--initial-memory=67108864 -C strip=symbols -C panic=abort"
    cargo build --target wasm32-unknown-unknown --release
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to compile SIMD128 WebP WASM module"
    }

    Write-Host "[4/4] Optimizing SIMD128 WASM with wasm-opt -Oz..." -ForegroundColor Yellow
    pnpm dlx wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int --enable-simd "$RawTarget" -o "$SimdOut"
    if ($LASTEXITCODE -ne 0) {
        throw "wasm-opt failed on SIMD128 module"
    }

    # -------------------------------------------------------------
    # 3. Size Verification Function
    # -------------------------------------------------------------
    function Get-GzipSize([string]$FilePath) {
        $bytes = [System.IO.File]::ReadAllBytes($FilePath)
        $ms = New-Object System.IO.MemoryStream
        $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
        $gz.Write($bytes, 0, $bytes.Length)
        $gz.Close()
        return $ms.ToArray().Length
    }

    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "                WASM Binary Size Audit                     " -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    $RawLimit = 300 * 1024  # 300 KB = 307200 bytes
    $GzipLimit = 80 * 1024  # 80 KB = 81920 bytes
    $AllPassed = $true

    $Modules = @(
        @{ Name = "webp_engine_scalar.wasm"; Path = $ScalarOut },
        @{ Name = "webp_engine_simd.wasm";   Path = $SimdOut }
    )

    foreach ($m in $Modules) {
        if (-not (Test-Path $m.Path)) {
            Write-Host "ERROR: Output file not found: $($m.Name)" -ForegroundColor Red
            $AllPassed = $false
            continue
        }

        $rawLen = (Get-Item $m.Path).Length
        $gzipLen = Get-GzipSize $m.Path
        $rawKb = [math]::Round($rawLen / 1024, 2)
        $gzipKb = [math]::Round($gzipLen / 1024, 2)

        $rawPass = $rawLen -lt $RawLimit
        $gzipPass = $gzipLen -lt $GzipLimit

        Write-Host "Module: $($m.Name)" -ForegroundColor White
        Write-Host "  Raw Size:  $rawLen bytes ($rawKb KB) [Limit: < 300 KB] -> $(if ($rawPass) { 'PASS' } else { 'FAIL' })" -ForegroundColor $(if ($rawPass) { 'Green' } else { 'Red' })
        Write-Host "  Gzip Size: $gzipLen bytes ($gzipKb KB) [Limit: < 80 KB]  -> $(if ($gzipPass) { 'PASS' } else { 'FAIL' })" -ForegroundColor $(if ($gzipPass) { 'Green' } else { 'Red' })

        if (-not ($rawPass -and $gzipPass)) {
            $AllPassed = $false
        }
    }

    Write-Host "============================================================" -ForegroundColor Cyan
    if ($AllPassed) {
        Write-Host "  RESULT: All WASM size budgets strictly satisfied! PASS    " -ForegroundColor Green
        Write-Host "============================================================" -ForegroundColor Cyan
    } else {
        Write-Host "  RESULT: One or more WASM modules exceeded size limits! FAIL" -ForegroundColor Red
        Write-Host "============================================================" -ForegroundColor Cyan
        exit 1
    }
}
finally {
    $env:RUSTFLAGS = $OriginalRustflags
}
