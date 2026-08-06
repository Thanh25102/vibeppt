param(
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\VibePPT Studio.lnk"

if ($Remove) {
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Output "Start Menu shortcut removed."
  }
  else { Write-Output "No Start Menu shortcut to remove." }
  return
}

# Presentations.Open can leave a half-dead COM object that throws on Quit, so every release is
# wrapped. A missing PowerPoint is a reportable state here, not a failure: the renderer still works.
$version = $null
$powerPoint = $null
try { $powerPoint = New-Object -ComObject PowerPoint.Application; $version = $powerPoint.Version }
catch { $version = $null }
finally {
  if ($powerPoint) {
    try { $powerPoint.Quit() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) } catch {}
  }
}
if ($version) { Write-Output "Microsoft PowerPoint $version detected; the QA gate is available." }
else { Write-Output "Microsoft PowerPoint was not found. Decks still build, but 'vibeppt qa --powerpoint' and 'vibeppt library index' cannot run." }

$studioScript = Join-Path $PackageRoot "scripts\start-studio.ps1"
if (-not (Test-Path $studioScript)) {
  Write-Output "start-studio.ps1 is missing, so no Start Menu shortcut was created."
  return
}
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $shortcutPath)) | Out-Null
$shell = New-Object -ComObject WScript.Shell
try {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $PSHOME "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$studioScript`""
  $shortcut.WorkingDirectory = $PackageRoot
  $shortcut.Description = "Open the local VibePPT template gallery"
  $shortcut.Save()
  Write-Output "Start Menu shortcut: VibePPT Studio"
}
finally { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch {} }
