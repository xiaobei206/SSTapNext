[CmdletBinding()]
param(
    [string]$Version = '1.14.4'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot 'runtime\sing-box'
$TempDir = Join-Path $env:TEMP ("SSTapNext-sing-box-" + [guid]::NewGuid().ToString('N'))
$AssetName = "sing-box-$Version-windows-amd64.zip"
$PinnedSha256 = '99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df'
$ApiUrl = "https://api.github.com/repos/SagerNet/sing-box/releases/tags/v$Version"
if ($Version -ne '1.14.4') { throw '此下载脚本目前只锁定经过审查的 sing-box 1.14.4；升级版本前请先审核核心变更及哈希。' }

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    Write-Host "查询 sing-box v$Version 官方发布信息..." -ForegroundColor Cyan
    $release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ 'User-Agent' = 'SSTapNext-DependencyFetcher/0.3.7'; 'Accept' = 'application/vnd.github+json' }
    if ($release.tag_name -ne "v$Version" -or $release.prerelease -or $release.draft) {
        throw '目标发布不是匹配的正式稳定版本，已停止下载。'
    }

    $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset) { throw "官方发布中未找到资产：$AssetName" }
    if (-not $asset.digest -or $asset.digest -notmatch '^sha256:([0-9a-fA-F]{64})$') {
        throw 'GitHub 发布资产没有提供可校验的 SHA-256 digest；为避免安装未经校验的核心，已停止。'
    }
    $expectedHash = $Matches[1].ToLowerInvariant()
    if ($expectedHash -ne $PinnedSha256) {
        throw "官方 Release API digest 与项目独立锁定的哈希不一致。预期 $PinnedSha256，API 返回 $expectedHash。"
    }
    $zipPath = Join-Path $TempDir $AssetName

    Write-Host "下载 $AssetName ..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers @{ 'User-Agent' = 'SSTapNext-DependencyFetcher/0.3.7' }

    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 不匹配。预期 $expectedHash，实际 $actualHash。文件不会被安装。"
    }

    $extractDir = Join-Path $TempDir 'extract'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $core = Get-ChildItem -LiteralPath $extractDir -Filter 'sing-box.exe' -File -Recurse | Select-Object -First 1
    if (-not $core) { throw '压缩包通过校验，但未找到 sing-box.exe。' }

    Copy-Item -LiteralPath $core.FullName -Destination (Join-Path $RuntimeDir 'sing-box.exe') -Force
    Get-ChildItem -LiteralPath $core.DirectoryName -File | Where-Object { $_.Name -ne 'sing-box.exe' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $RuntimeDir -Force
    }

    $installedHash = (Get-FileHash -LiteralPath (Join-Path $RuntimeDir 'sing-box.exe') -Algorithm SHA256).Hash
    @"
SSTap Next runtime dependency
sing-box version: $Version
release tag: $($release.tag_name)
asset: $AssetName
asset SHA-256: $actualHash
installed executable SHA-256: $installedHash
source: https://github.com/SagerNet/sing-box/releases/tag/v$Version
"@ | Set-Content -LiteralPath (Join-Path $RuntimeDir 'DEPENDENCY.txt') -Encoding UTF8

    Write-Host "[OK] sing-box v$Version 已安装并通过 SHA-256 校验。" -ForegroundColor Green
    Write-Host "路径：$(Join-Path $RuntimeDir 'sing-box.exe')"
}
finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
