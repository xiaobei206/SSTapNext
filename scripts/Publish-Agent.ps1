[CmdletBinding()]
param(
    [ValidateSet('win-x64')][string]$RuntimeIdentifier = 'win-x64'
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $RepoRoot 'src\agent\SstapNext.Agent\SstapNext.Agent.csproj'
$PublishDir = Join-Path $RepoRoot 'artifacts\agent-win-x64'

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) { throw '.NET 10 SDK 未安装。请安装 .NET 10 SDK 后重新运行。' }
$versionOutput = (& dotnet --version 2>&1).Trim()
if ($LASTEXITCODE -ne 0 -or [version]$versionOutput -lt [version]'10.0.100') {
    throw "需要 .NET 10 SDK（当前：$versionOutput）。"
}

if (Test-Path -LiteralPath $PublishDir) {
    Remove-Item -LiteralPath $PublishDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PublishDir | Out-Null

Write-Host "发布 SSTap Next Agent（$RuntimeIdentifier，自包含、单文件）..." -ForegroundColor Cyan
& dotnet publish $Project -c Release -r $RuntimeIdentifier --self-contained true -o $PublishDir `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true 2>&1
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 失败。' }

$Agent = Join-Path $PublishDir 'SstapNext.Agent.exe'
if (-not (Test-Path -LiteralPath $Agent -PathType Leaf)) { throw '发布结果中没有 SstapNext.Agent.exe。' }
$hash = (Get-FileHash -LiteralPath $Agent -Algorithm SHA256).Hash
@"
SSTap Next Windows Agent
Runtime: $RuntimeIdentifier
Framework: .NET 10
Publish: self-contained / single-file
SHA-256: $hash
"@ | Set-Content -LiteralPath (Join-Path $PublishDir 'AGENT-MANIFEST.txt') -Encoding UTF8
Write-Host "[OK] Agent 已发布：$Agent" -ForegroundColor Green
Write-Host "SHA-256：$hash"
