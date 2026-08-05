param(
  [Parameter(Mandatory = $true)][string]$InputPptx,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = "Stop"
$inputPath = (Resolve-Path $InputPptx).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $presentation = $powerPoint.Presentations.Open($inputPath, $true, $false, $false)
  $presentation.Export($outputPath, "PNG", 1920, 1080)

  $slides = @()
  for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
    $source = Join-Path $outputPath ("Slide{0}.PNG" -f $index)
    $targetName = "slide-{0:d3}.png" -f $index
    $target = Join-Path $outputPath $targetName
    if (Test-Path $source) { Move-Item -Force $source $target }
    $slides += $targetName
  }

  [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString("o")
    powerPointVersion = $powerPoint.Version
    source = $inputPath
    slideCount = $presentation.Slides.Count
    width = 1920
    height = 1080
    slides = $slides
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $outputPath "powerpoint-render.json")
}
finally {
  if ($presentation) { try { $presentation.Close() } catch { } }
  if ($powerPoint) { try { $powerPoint.Quit() } catch { } }
  if ($presentation) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) } catch { } }
  if ($powerPoint) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) } catch { } }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
