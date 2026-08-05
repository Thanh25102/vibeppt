$ErrorActionPreference = "Stop"
$command = Get-Command vibeppt.cmd -ErrorAction SilentlyContinue
if (-not $command) { $command = Get-Command vibeppt -ErrorAction SilentlyContinue }
if (-not $command) { throw "VibePPT CLI was not found. Run scripts\install.ps1 again." }
& $command.Source studio
