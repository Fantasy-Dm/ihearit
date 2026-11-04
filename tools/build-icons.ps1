$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '..\ui\icons'
[xml]$source = Get-Content -LiteralPath (Join-Path $iconDirectory 'icon.svg') -Raw -Encoding UTF8
$bitmap = New-Object Drawing.Bitmap(512,512)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(4,4)
    foreach ($shape in $source.SelectNodes("//*[local-name()='path']")) {
        $tokens = [regex]::Matches($shape.GetAttribute('d'), '[MCZ]|-?\d+(?:\.\d+)?') | ForEach-Object { $_.Value }
        $curve = New-Object Drawing.Drawing2D.GraphicsPath
        try {
            $index = 0; [single]$pointX = 0; [single]$pointY = 0
            while ($index -lt $tokens.Count) {
                $command = $tokens[$index]; $index++
                switch ($command) {
                    'M' { $curve.StartFigure(); $pointX = [single]::Parse($tokens[$index],[Globalization.CultureInfo]::InvariantCulture); $pointY = [single]::Parse($tokens[$index+1],[Globalization.CultureInfo]::InvariantCulture); $index += 2 }
                    'C' { $numbers = @(); for ($n=0; $n -lt 6; $n++) { $numbers += [single]::Parse($tokens[$index+$n],[Globalization.CultureInfo]::InvariantCulture) }; $curve.AddBezier($pointX,$pointY,$numbers[0],$numbers[1],$numbers[2],$numbers[3],$numbers[4],$numbers[5]); $pointX = $numbers[4]; $pointY = $numbers[5]; $index += 6 }
                    'Z' { $curve.CloseFigure() }
                    default { throw ('Unsupported icon path command: ' + $command) }
                }
            }
            $fill = $shape.GetAttribute('fill')
            if ($fill -and $fill -ne 'none') { $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($fill)); try { $graphics.FillPath($brush,$curve) } finally { $brush.Dispose() } }
            $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml($shape.GetAttribute('stroke')),[single]::Parse($shape.GetAttribute('stroke-width'),[Globalization.CultureInfo]::InvariantCulture))
            try { $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round; $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round; $graphics.DrawPath($pen,$curve) } finally { $pen.Dispose() }
        } finally { $curve.Dispose() }
    }
} finally { $graphics.Dispose() }
function Get-PngBytes([int]$size) {
    $scaled = New-Object Drawing.Bitmap($size,$size)
    $drawing = [Drawing.Graphics]::FromImage($scaled)
    $stream = New-Object IO.MemoryStream
    try {
        $drawing.Clear([Drawing.Color]::Transparent)
        $drawing.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $drawing.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $drawing.DrawImage($bitmap,0,0,$size,$size)
        $scaled.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally { $drawing.Dispose(); $scaled.Dispose(); $stream.Dispose() }
}
try {
    foreach ($size in @(192,512)) { [IO.File]::WriteAllBytes((Join-Path $iconDirectory "icon-$size.png"),(Get-PngBytes $size)) }
    $sizes = @(16,20,24,32,40,48,64,128,256)
    $frames = @(); foreach ($size in $sizes) { $frames += ,(Get-PngBytes $size) }
    $stream = New-Object IO.MemoryStream
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($i=0; $i -lt $sizes.Count; $i++) {
            $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
            $offset += $frames[$i].Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
        $writer.Flush(); [IO.File]::WriteAllBytes((Join-Path $iconDirectory 'icon.ico'),$stream.ToArray())
    } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $bitmap.Dispose() }
Write-Output 'Built I Hear It icons (16 through 512 pixels).'
