param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot
$skillSource = Join-Path $packageRoot "skill\beautiful-ppt"
$skillRoot = Join-Path $env:USERPROFILE ".codex\skills"
$skillTarget = Join-Path $skillRoot "beautiful-ppt"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22 or newer is required." }
$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required." }

$powerPoint = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  Write-Host "Microsoft PowerPoint $($powerPoint.Version) detected."
}
finally {
  if ($powerPoint) {
    $powerPoint.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint)
  }
}

Push-Location $packageRoot
try {
  if (-not $SkipInstall) { npm install --ignore-scripts }
  npm run build
  npm link
}
finally { Pop-Location }

[System.IO.Directory]::CreateDirectory($skillRoot) | Out-Null
if (Test-Path $skillTarget) {
  $backup = "$skillTarget.backup-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss'))"
  Move-Item $skillTarget $backup
  Write-Host "Previous skill moved to $backup"
}
Copy-Item -Recurse $skillSource $skillTarget

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
[System.IO.Directory]::CreateDirectory($startMenu) | Out-Null
$shortcutPath = Join-Path $startMenu "VibePPT Studio.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSHOME "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $packageRoot 'scripts\start-studio.ps1')`""
$shortcut.WorkingDirectory = $packageRoot
$shortcut.Description = "Open the local VibePPT template gallery"
$shortcut.Save()

Write-Host "Installed VibePPT CLI and Codex skill."
Write-Host "Start Menu shortcut: VibePPT Studio"
Write-Host "Restart Codex, then ask: Use `$beautiful-ppt to create a presentation from my files."
Write-Host "CLI check: vibeppt help"
