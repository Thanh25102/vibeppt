# Installs from a git checkout. To install from a packed tarball instead, run
#   npm install -g --ignore-scripts .\vibeppt-cli-<version>.tgz
#   vibeppt setup
# which skips the build and reaches the same end state.
param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22 or newer is required." }
$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required." }

Push-Location $packageRoot
try {
  if (-not $SkipInstall) { npm install --ignore-scripts }
  npm run build
  npm link
  # One implementation of "install the skills, check PowerPoint, make the shortcut", shared with
  # the tarball path. It resolves its own package root, so it works either way.
  node (Join-Path $packageRoot "dist\cli.js") setup
}
finally { Pop-Location }

Write-Host "CLI check: vibeppt help"
