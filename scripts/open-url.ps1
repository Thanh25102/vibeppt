param([Parameter(Mandatory = $true)][string]$Url)

$ErrorActionPreference = "Stop"
Start-Process $Url
