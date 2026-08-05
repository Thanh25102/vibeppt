param(
  [Parameter(Mandatory = $true)][string]$InputPptx,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$SlideIndices = "",
  [ValidateSet("PNG", "JPG")][string]$Format = "PNG",
  [ValidateRange(160, 3840)][int]$Width = 1920,
  [ValidateRange(90, 2160)][int]$Height = 1080
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
  $slides = @()
  $indices = if ($SlideIndices) {
    @($SlideIndices.Split(",") | ForEach-Object { [int]$_.Trim() } | Where-Object { $_ -ge 1 -and $_ -le $presentation.Slides.Count } | Select-Object -Unique)
  } else {
    @(1..$presentation.Slides.Count)
  }
  $extension = $Format.ToLowerInvariant()

  foreach ($index in $indices) {
    $slide = $presentation.Slides.Item($index)
    $imageName = "slide-{0:d3}.{1}" -f $index, $extension
    $slide.Export((Join-Path $outputPath $imageName), $Format, $Width, $Height)

    $text = @()
    foreach ($shape in $slide.Shapes) {
      try {
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $value = $shape.TextFrame.TextRange.Text.Trim()
          if ($value) { $text += $value }
        }
      } catch { }
    }
    $notes = @()
    foreach ($shape in $slide.NotesPage.Shapes) {
      try {
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $value = $shape.TextFrame.TextRange.Text.Trim()
          if ($value -and $value -notmatch "^\d+$") { $notes += $value }
        }
      } catch { }
    }
    $slides += [ordered]@{
      index = $index
      image = $imageName
      text = $text
      notes = $notes
    }
  }

  [ordered]@{
    version = 1
    importedAt = [DateTime]::UtcNow.ToString("o")
    source = $inputPath
    width = $Width
    height = $Height
    format = $Format
    instruction = "Use these slides as content and visual references. Rebuild the new deck from DeckSpec; do not edit this PPTX in place."
    slides = $slides
  } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $outputPath "reference.json")
}
finally {
  if ($presentation) { try { $presentation.Close() } catch { } }
  if ($powerPoint) { try { $powerPoint.Quit() } catch { } }
  if ($presentation) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) } catch { } }
  if ($powerPoint) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) } catch { } }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
