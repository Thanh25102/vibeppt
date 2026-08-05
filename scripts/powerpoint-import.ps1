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
    $slide = $presentation.Slides.Item($index)
    $imageName = "slide-{0:d3}.png" -f $index
    $powerPointImage = Join-Path $outputPath ("Slide{0}.PNG" -f $index)
    if (Test-Path $powerPointImage) { Move-Item -Force $powerPointImage (Join-Path $outputPath $imageName) }

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
    instruction = "Use these slides as content and visual references. Rebuild the new deck from DeckSpec; do not edit this PPTX in place."
    slides = $slides
  } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $outputPath "reference.json")
}
finally {
  if ($presentation) { $presentation.Close() }
  if ($powerPoint) { $powerPoint.Quit() }
  if ($presentation) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($powerPoint) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
