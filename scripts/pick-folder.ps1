$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Chọn thư mục chứa project VibePPT"
$dialog.ShowNewFolderButton = $true
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.SelectedPath
  }
}
finally { $dialog.Dispose() }
