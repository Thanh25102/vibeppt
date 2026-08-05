param([Parameter(Mandatory = $true)][string]$ProjectPath)

$ErrorActionPreference = "Stop"
$code = Get-Command code.cmd -ErrorAction SilentlyContinue
if (-not $code) { $code = Get-Command code -ErrorAction SilentlyContinue }
if (-not $code) { throw "VS Code command 'code' was not found. Reinstall VS Code with Add to PATH enabled." }
& $code.Source --new-window $ProjectPath
