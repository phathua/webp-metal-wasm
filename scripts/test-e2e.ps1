<#
.SYNOPSIS
  Executes the WebAssembly WebP Engine E2E Test Suite across Tiers 1-4.

.DESCRIPTION
  One-command automated test runner invoking Node.js with headless browser automation.
  Supports Obscura (1st Priority, D:\DevEnv\browsers\obscura\obscura.exe)
  and Chrome Headless Shell (Fallback, D:\DevEnv\browsers\chrome-headless-shell\).

.PARAMETER Tier
  Testing tier to execute: '1', '2', '3', '4', or 'all' (default: 'all').

.PARAMETER Browser
  Headless browser engine: 'auto', 'obscura', or 'chrome-headless-shell' (default: 'auto').

.PARAMETER Port
  Remote debugging port for Chrome DevTools Protocol (CDP).

.PARAMETER Verbose
  Enables verbose debugging output from the test runner.

.EXAMPLE
  .\scripts\test-e2e.ps1
  .\scripts\test-e2e.ps1 -Tier 1
  .\scripts\test-e2e.ps1 -Browser chrome-headless-shell
  .\scripts\test-e2e.ps1 -Tier 2 -Verbose
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('1', '2', '3', '4', 'all')]
  [string]$Tier = 'all',

  [Parameter(Position = 1)]
  [ValidateSet('auto', 'obscura', 'chrome-headless-shell')]
  [string]$Browser = 'auto',

  [Parameter()]
  [int]$Port = 0,

  [Parameter()]
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Get-Help $MyInvocation.MyCommand.Path -Full
  exit 0
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$RunnerScript = Join-Path $ProjectRoot "tests\e2e\runner.mjs"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " WebAssembly WebP Engine - E2E Test Suite Launcher" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Project Root:  $ProjectRoot" -ForegroundColor Gray
Write-Host " Target Tier:   $Tier" -ForegroundColor Gray
Write-Host " Browser Mode:  $Browser" -ForegroundColor Gray

# Ensure Node is available
try {
  $nodeVer = & node -v
  Write-Host " Node Runtime:  $nodeVer" -ForegroundColor Gray
} catch {
  Write-Error "Node.js is required but was not found in PATH."
  exit 3
}

# Verify test runner file exists
if (-not (Test-Path $RunnerScript)) {
  Write-Error "Test runner script not found at $RunnerScript"
  exit 3
}

# Prepare arguments
$nodeArgs = @($RunnerScript, "--tier=$Tier", "--browser=$Browser")

if ($Port -gt 0) {
  $nodeArgs += "--port=$Port"
}

if ($PSCmdlet.MyInvocation.BoundParameters.ContainsKey('Verbose') -and $PSCmdlet.MyInvocation.BoundParameters['Verbose']) {
  $nodeArgs += "--verbose"
}

Write-Host " Invoking runner: node $($nodeArgs -join ' ')" -ForegroundColor DarkGray
Write-Host ""

# Execute Node runner
$process = Start-Process -FilePath "node" -ArgumentList $nodeArgs -NoNewWindow -PassThru -Wait

$exitCode = $process.ExitCode

if ($exitCode -eq 0) {
  Write-Host ""
  Write-Host "[SUCCESS] All E2E test suites passed with exit code 0." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "[FAILURE] E2E test execution failed with exit code $exitCode." -ForegroundColor Red
}

exit $exitCode
