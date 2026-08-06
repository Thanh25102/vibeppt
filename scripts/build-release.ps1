# Builds both Windows deliverables from one staged payload:
#   dist-installer\VibePPT-Setup-<version>.exe        needs Inno Setup; skipped if absent
#   dist-installer\VibePPT-<version>-portable.zip     always
# The payload is the built app, its production dependencies and a portable node.exe, so the
# target machine needs nothing but Windows.
param([string]$NodeExe = "", [switch]$SkipInstaller)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $packageRoot "package.json") -Raw | ConvertFrom-Json).version
$payloadName = "VibePPT-$version"
$payload = Join-Path $packageRoot "installer\$payloadName"
$output = Join-Path $packageRoot "dist-installer"

if (-not $NodeExe) { $NodeExe = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path $NodeExe)) { throw "Node executable not found: $NodeExe" }
# The bundled runtime is whatever this machine runs, so it has to satisfy the same floor as the CLI.
$nodeMajor = [int]((& $NodeExe --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Bundle Node 22 or newer; $NodeExe reports major version $nodeMajor." }

$iscc = $null
if (-not $SkipInstaller) {
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
  if (-not $iscc) { Write-Warning "Inno Setup 6 not found, building the portable zip only. Install it with: winget install --id JRSoftware.InnoSetup" }
}

foreach ($stale in @($payload, (Join-Path $packageRoot "installer\staging"))) {
  if (Test-Path $stale) { [System.IO.Directory]::Delete($stale, $true) }
}
[System.IO.Directory]::CreateDirectory($payload) | Out-Null
[System.IO.Directory]::CreateDirectory($output) | Out-Null

Push-Location $packageRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  foreach ($item in @("dist", "templates", "presets", "studio", "scripts", "skill", "examples")) {
    Copy-Item -Recurse (Join-Path $packageRoot $item) (Join-Path $payload $item)
  }
  foreach ($item in @("package.json", "package-lock.json", "LICENSE.md", "README.md")) {
    Copy-Item (Join-Path $packageRoot $item) $payload
  }
  Copy-Item $NodeExe (Join-Path $payload "node.exe")
  # Resolves node and the CLI relative to itself, so the folder works wherever it ends up.
  Set-Content -Path (Join-Path $payload "vibeppt.cmd") -Encoding ascii -Value @(
    '@echo off',
    '"%~dp0node.exe" "%~dp0dist\cli.js" %*'
  )
}
finally { Pop-Location }

Push-Location $payload
try {
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Dependency install failed." }
  Remove-Item (Join-Path $payload "package-lock.json") -Force
}
finally { Pop-Location }

# The installer is compiled first, from the bare payload: its Start Menu group and Add/Remove
# entry are the uninstall route there, so the portable launchers would only confuse that layout.
if ($iscc) {
  & $iscc "/DAppVersion=$version" "/DPayloadDir=$payloadName" (Join-Path $packageRoot "installer\vibeppt.iss")
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
}

Copy-Item (Join-Path $packageRoot "installer\portable\*") $payload
$zip = Join-Path $output "$payloadName-portable.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# includeBaseDirectory keeps everything inside one folder, so extracting never sprays 600 files
# across the user's Downloads.
[System.IO.Compression.ZipFile]::CreateFromDirectory($payload, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)

Write-Host ""
foreach ($artifact in (Get-ChildItem $output -File | Sort-Object Name)) {
  Write-Host ("{0,-44} {1,6} MB" -f $artifact.Name, [math]::Round($artifact.Length / 1MB, 1))
}
Write-Host "Bundled Node: $(& $NodeExe --version)"
