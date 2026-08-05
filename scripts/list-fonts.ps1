$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$collection = New-Object System.Drawing.Text.InstalledFontCollection
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  @($collection.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) | ConvertTo-Json -Compress
}
finally {
  $collection.Dispose()
}
