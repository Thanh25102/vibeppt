param([ValidateSet("logo", "sources")][string]$Kind = "sources")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $Kind -eq "sources"
$dialog.Title = if ($Kind -eq "logo") { "Chọn logo" } else { "Chọn tài liệu nguồn" }
$dialog.Filter = if ($Kind -eq "logo") {
  "Logo (*.png;*.jpg;*.jpeg;*.webp;*.svg)|*.png;*.jpg;*.jpeg;*.webp;*.svg"
} else {
  "Presentation sources|*.pptx;*.ppt;*.pdf;*.docx;*.doc;*.xlsx;*.xls;*.csv;*.txt;*.md;*.png;*.jpg;*.jpeg;*.webp;*.svg|All files|*.*"
}
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    ConvertTo-Json -InputObject @($dialog.FileNames) -Compress
  }
}
finally { $dialog.Dispose() }
