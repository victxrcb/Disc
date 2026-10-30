# Gera as imagens do instalador NSIS (BMP 24 bits) a partir da arte do castelo.
# Uso: powershell -ExecutionPolicy Bypass -File build/make-installer-art.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$art = [System.Drawing.Image]::FromFile((Join-Path $root 'public/images/castelo-panoramico-v2.png'))
$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'build/icon.png'))

function New-Canvas([int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = 'AntiAlias'
  $graphics.InterpolationMode = 'HighQualityBicubic'
  $graphics.TextRenderingHint = 'AntiAliasGridFit'
  $graphics.Clear([System.Drawing.Color]::Black)
  return @($bitmap, $graphics)
}

function Save-Bmp($bitmap, [string]$name) {
  $bitmap.Save((Join-Path $root "build/$name"), [System.Drawing.Imaging.ImageFormat]::Bmp)
}

# Lateral das telas de boas-vindas e conclusão (164x314).
$bitmap, $g = New-Canvas 164 314
# Recorte vertical centrado no castelo, escurecido.
$cropWidth = [int]($art.Height * 164 / 314)
$source = New-Object System.Drawing.Rectangle([int]($art.Width * 0.12), 0, $cropWidth, $art.Height)
$g.DrawImage($art, (New-Object System.Drawing.Rectangle(0, 0, 164, 314)), $source, 'Pixel')
$shade = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(0, 314)), [System.Drawing.Color]::FromArgb(70, 0, 0, 0), [System.Drawing.Color]::FromArgb(235, 0, 0, 0))
$g.FillRectangle($shade, 0, 0, 164, 314)
$titleFont = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$subFont = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 255))
$g.DrawString('Discord', $titleFont, $white, 12, 226)
$g.DrawString('2.0', $titleFont, $muted, 12, 252)
$g.DrawString('Chamadas com a galera', $subFont, $muted, 14, 286)
Save-Bmp $bitmap 'installerSidebar.bmp'
$g.Dispose(); $bitmap.Dispose()

# Cabeçalho das telas internas (150x57).
$bitmap, $g = New-Canvas 150 57
$source = New-Object System.Drawing.Rectangle([int]($art.Width * 0.05), [int]($art.Height * 0.08), [int]($art.Width * 0.6), [int]($art.Width * 0.6 * 57 / 150))
$g.DrawImage($art, (New-Object System.Drawing.Rectangle(0, 0, 150, 57)), $source, 'Pixel')
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 0, 0, 0))), 0, 0, 150, 57)
$g.DrawImage($icon, 104, 10, 37, 37)
$small = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('Discord 2.0', $small, $white, 8, 19)
Save-Bmp $bitmap 'installerHeader.bmp'
$g.Dispose(); $bitmap.Dispose()

$art.Dispose(); $icon.Dispose()
Write-Output 'Imagens do instalador geradas em build/.'
