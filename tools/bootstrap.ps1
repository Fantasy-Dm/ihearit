param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$runtimeConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.json') -Raw | ConvertFrom-Json
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeBinary = if ($nodeCommand) { $nodeCommand.Source } else { $null }
    $currentVersion = if ($nodeBinary) { (& $nodeBinary --version).TrimStart('v') } else { '' }
    $localNode = Join-Path $projectRoot 'runtime\node.exe'
    if ($currentVersion -ne $runtimeConfig.version) {
        if ((Test-Path -LiteralPath $localNode) -and (Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\npm.cmd')) -and ((& $localNode --version).TrimStart('v') -eq $runtimeConfig.version)) {
            $nodeBinary = $localNode
        } else {
            Write-Host "Preparing portable Node.js $($runtimeConfig.version), without changing system settings..."
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $runtimeDirectory = Join-Path $projectRoot 'runtime'
            New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
            $downloadDirectory = Join-Path $runtimeDirectory ('.setup-' + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
            $archive = Join-Path $downloadDirectory $runtimeConfig.archive
            Invoke-WebRequest -UseBasicParsing -Uri ("https://nodejs.org/dist/v{0}/{1}" -f $runtimeConfig.version, $runtimeConfig.archive) -OutFile $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeConfig.sha256) { throw 'Node.js archive checksum does not match. Setup stopped.' }
            Expand-Archive -LiteralPath $archive -DestinationPath $downloadDirectory
            $expanded = Join-Path $downloadDirectory ("node-v{0}-{1}" -f $runtimeConfig.version, $runtimeConfig.platform)
            Get-ChildItem -LiteralPath $expanded -Force | Copy-Item -Destination $runtimeDirectory -Recurse -Force
            $checkedDownload = [IO.Path]::GetFullPath($downloadDirectory)
            if (-not $checkedDownload.StartsWith([IO.Path]::GetFullPath($runtimeDirectory) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected temporary directory.' }
            Remove-Item -LiteralPath $checkedDownload -Recurse -Force
            $nodeBinary = $localNode
        }
    }
    $nodeDirectory = Split-Path -Parent $nodeBinary
    $env:PATH = $nodeDirectory + ';' + $env:PATH
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { throw 'npm.cmd is missing. Use the complete official Node.js distribution.' }
    $lockFile = Join-Path $projectRoot 'package-lock.json'
    $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
    $installedStamp = Join-Path $projectRoot 'node_modules\.ihearit-lock.sha256'
    $installedHash = if (Test-Path -LiteralPath $installedStamp) { (Get-Content -LiteralPath $installedStamp -Raw).Trim() } else { '' }
    $runtimeReady = (Test-Path -LiteralPath 'node_modules\onnxruntime-node\dist\index.js') -and (Test-Path -LiteralPath 'node_modules\@xmldom\xmldom\lib\index.js')
    if (($installedHash -ne $lockHash) -or -not $runtimeReady) {
        Write-Host 'Installing the exact dependency versions from package-lock.json...'
        & $npmCommand.Source ci --ignore-scripts --omit=dev --no-audit --no-fund --cache (Join-Path $projectRoot '.npm-cache')
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Run this BAT again after checking the connection.' }
        Set-Content -LiteralPath $installedStamp -Value $lockHash -Encoding ASCII
    } else { Write-Host 'Locked dependencies are ready.' }
    Write-Host 'Preparing the I Hear It launcher...'
    & $nodeBinary (Join-Path $PSScriptRoot 'compile-launcher.js')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    if ($PrepareOnly) { Write-Host 'Preparation complete. No application window was opened.'; exit 0 }
    Write-Host 'Starting I Hear It. Audio decoding uses your installed Kdenlive/FFmpeg.'
    Start-Process -FilePath (Join-Path $projectRoot 'ihearit.exe') -WorkingDirectory $projectRoot -WindowStyle Hidden
    exit 0
} catch { Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
