# Builds the per-user Windows installer. The payload is a portable node.exe plus the built app
# and its production dependencies, so the target machine needs nothing but Windows.
param([string]$NodeExe = "")

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $packageRoot "installer\staging"
$version = (Get-Content (Join-Path $packageRoot "package.json") -Raw | ConvertFrom-Json).version

if (-not $NodeExe) { $NodeExe = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path $NodeExe)) { throw "Node executable not found: $NodeExe" }
# The bundled runtime is whatever this machine runs, so it has to satisfy the same floor as the CLI.
$nodeMajor = [int]((& $NodeExe --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Bundle Node 22 or newer; $NodeExe reports major version $nodeMajor." }

$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  # winget installs Inno Setup per-user by default, so check LOCALAPPDATA before Program Files.
  foreach ($candidate in @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )) {
    if (Test-Path $candidate) { $iscc = $candidate; break }
  }
}
if (-not $iscc) { throw "Inno Setup 6 is required. Install it with: winget install --id JRSoftware.InnoSetup" }

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
[System.IO.Directory]::CreateDirectory($staging) | Out-Null

Push-Location $packageRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  foreach ($item in @("dist", "templates", "presets", "studio", "scripts", "skill", "examples")) {
    Copy-Item -Recurse (Join-Path $packageRoot $item) (Join-Path $staging $item)
  }
  foreach ($item in @("package.json", "package-lock.json", "LICENSE.md", "README.md")) {
    Copy-Item (Join-Path $packageRoot $item) $staging
  }
  Copy-Item $NodeExe (Join-Path $staging "node.exe")
  # Resolves node and the CLI relative to itself, so {app} works wherever the user installs it.
  Set-Content -Path (Join-Path $staging "vibeppt.cmd") -Encoding ascii -Value @(
    '@echo off',
    '"%~dp0node.exe" "%~dp0dist\cli.js" %*'
  )
}
finally { Pop-Location }

Push-Location $staging
try {
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Dependency install failed." }
  Remove-Item (Join-Path $staging "package-lock.json") -Force
}
finally { Pop-Location }

& $iscc "/DAppVersion=$version" (Join-Path $packageRoot "installer\vibeppt.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }

$output = Join-Path $packageRoot "dist-installer\VibePPT-Setup-$version.exe"
Write-Host ""
Write-Host "Installer: $output"
Write-Host "Size: $([math]::Round((Get-Item $output).Length / 1MB, 1)) MB"
Write-Host "Bundled Node: $(& $NodeExe --version)"
