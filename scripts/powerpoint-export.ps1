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
  # Flat list rather than nested per slide, so the JSON stays shallow enough for ConvertTo-Json.
  $shapes = @()
  for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
    $source = Join-Path $outputPath ("Slide{0}.PNG" -f $index)
    $targetName = "slide-{0:d3}.png" -f $index
    $target = Join-Path $outputPath $targetName
    if (Test-Path $source) { Move-Item -Force $source $target }
    $slides += $targetName

    # Geometry is in points against a 960x540 slide. BoundWidth/BoundHeight are the extents
    # PowerPoint actually laid the text out at, which is what catches overflow the DOM cannot see.
    foreach ($shape in $presentation.Slides.Item($index).Shapes) {
      $entry = [ordered]@{
        slide = $index
        name = ""
        left = 0.0; top = 0.0; width = 0.0; height = 0.0
        hasText = $false
        boundWidth = 0.0; boundHeight = 0.0
        text = ""
      }
      try {
        $entry.name = [string]$shape.Name
        $entry.left = [math]::Round([double]$shape.Left, 2)
        $entry.top = [math]::Round([double]$shape.Top, 2)
        $entry.width = [math]::Round([double]$shape.Width, 2)
        $entry.height = [math]::Round([double]$shape.Height, 2)
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $range = $shape.TextFrame2.TextRange
          $entry.hasText = $true
          $entry.boundWidth = [math]::Round([double]$range.BoundWidth, 2)
          $entry.boundHeight = [math]::Round([double]$range.BoundHeight, 2)
          $value = [string]$range.Text
          if ($value.Length -gt 160) { $value = $value.Substring(0, 160) }
          $entry.text = $value
        }
      } catch { }
      $shapes += $entry
    }
  }

  [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString("o")
    powerPointVersion = $powerPoint.Version
    source = $inputPath
    slideCount = $presentation.Slides.Count
    width = 1920
    height = 1080
    slideWidthPt = [math]::Round([double]$presentation.PageSetup.SlideWidth, 2)
    slideHeightPt = [math]::Round([double]$presentation.PageSetup.SlideHeight, 2)
    slides = $slides
    shapes = $shapes
  } | ConvertTo-Json -Depth 4 | Out-String | ForEach-Object {
    # Windows PowerShell's -Encoding UTF8 emits a BOM that JSON.parse refuses to read.
    [System.IO.File]::WriteAllText((Join-Path $outputPath "powerpoint-render.json"), $_, (New-Object System.Text.UTF8Encoding $false))
  }
}
finally {
  if ($presentation) { try { $presentation.Close() } catch { } }
  if ($powerPoint) { try { $powerPoint.Quit() } catch { } }
  if ($presentation) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) } catch { } }
  if ($powerPoint) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) } catch { } }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
