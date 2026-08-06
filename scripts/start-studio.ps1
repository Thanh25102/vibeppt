$ErrorActionPreference = "Stop"

# In an installed layout the launcher sits next to this script's parent; in a git checkout it does
# not, and the globally linked command is used instead.
$bundled = Join-Path (Split-Path -Parent $PSScriptRoot) "vibeppt.cmd"
if (Test-Path $bundled) {
  & $bundled studio
  return
}

$command = Get-Command vibeppt.cmd -ErrorAction SilentlyContinue
if (-not $command) { $command = Get-Command vibeppt -ErrorAction SilentlyContinue }
if (-not $command) { throw "VibePPT CLI was not found. Run scripts\install.ps1 again." }
& $command.Source studio
