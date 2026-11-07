[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipCoreDownload,
    [switch]$NoPackage
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw '该脚本必须在 Windows 10/11 x64 上运行。' }
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $node -or -not $npm -or -not $dotnet) { throw '需要 Node.js、npm.cmd 与 .NET 10 SDK。' }
$nodeVersion = (& node --version 2>&1).Trim().TrimStart('v')
if ([version]$nodeVersion -lt [version]'22.0.0') { throw "需要 Node.js 22 或更高版本，当前 $nodeVersion。" }
$dotnetVersion = (& dotnet --version 2>&1).Trim()
if ([version]$dotnetVersion -lt [version]'10.0.100') { throw "需要 .NET 10 SDK，当前 $dotnetVersion。" }

Write-Host '[0/8] 校验 package.json 与 package-lock.json...' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'verify-package-lock.mjs') 2>&1
if ($LASTEXITCODE -ne 0) { throw 'package-lock 一致性检查失败；未下载核心、未安装依赖。' }

$core = Join-Path $RepoRoot 'runtime\sing-box\sing-box.exe'
if (-not (Test-Path -LiteralPath $core)) {
    if ($SkipCoreDownload) { throw '未找到 sing-box.exe，且指定了 -SkipCoreDownload。' }
    & (Join-Path $PSScriptRoot 'Fetch-SingBox.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'sing-box 下载脚本失败。' }
}

if (-not $SkipInstall) {
    Write-Host '[1/8] 安装 Node 依赖...' -ForegroundColor Cyan
    & npm.cmd install --no-audit --no-fund 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败。' }
} else {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules'))) { throw '-SkipInstall 已指定，但 node_modules 不存在。' }
}

Write-Host '[2/8] 自动化测试...' -ForegroundColor Cyan
& npm.cmd test 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Node 自动化测试失败。' }

$coreVersionOutput = & $core version 2>&1
if ($LASTEXITCODE -ne 0) { throw '当前 runtime/sing-box/sing-box.exe 无法执行 version。' }
$coreVersionLine = ($coreVersionOutput | Select-Object -First 1).ToString().Trim()
Write-Host "[3/8] 使用当前核心（$coreVersionLine）检查 54 份协议/模式/DNS 地址族组合配置及 1 份 SSTap 本地规则集配置..." -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'validate-singbox-configs.mjs') --core $core 2>&1
if ($LASTEXITCODE -ne 0) { throw 'sing-box 配置验收失败；已停止打包。' }

Write-Host '[4/8] 编译 Windows Agent...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'Publish-Agent.ps1')
if ($LASTEXITCODE -ne 0) { throw '.NET Agent 发布失败。' }

Write-Host '[5/8] TypeScript 与 Vite 正式构建...' -ForegroundColor Cyan
& npm.cmd run build 2>&1
if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }

if (-not $NoPackage) {
    Write-Host '[6/8] 生成 Windows NSIS 安装包...' -ForegroundColor Cyan
    & npm.cmd run dist:win -- --publish never 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Electron NSIS 打包失败。' }
} else {
    Write-Host '[6/8] 跳过 NSIS 安装包生成（-NoPackage）。' -ForegroundColor Yellow
}

Write-Host '[7/8] 检查交付产物...' -ForegroundColor Cyan
$checks = @(
    (Join-Path $RepoRoot 'dist\renderer\index.html'),
    (Join-Path $RepoRoot 'artifacts\agent-win-x64\SstapNext.Agent.exe'),
    (Join-Path $RepoRoot 'runtime\sing-box\sing-box.exe')
)
foreach ($item in $checks) {
    if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "缺少构建产物：$item" }
}
$installer = $null
if (-not $NoPackage) {
    $installer = Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'release') -Filter '*.exe' -File | Where-Object Name -Match 'SSTap Next' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'release 目录中未找到 SSTap Next 安装包。' }
}

Write-Host '[8/8] 最终环境诊断...' -ForegroundColor Cyan
& npm.cmd run doctor 2>&1
if ($LASTEXITCODE -ne 0) { throw '最终环境诊断失败。' }

Write-Host ''
Write-Host '[SUCCESS] SSTap Next 0.3.12 构建流程完成。' -ForegroundColor Green
if ($installer) {
    $installerHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
    Write-Host "安装包：$($installer.FullName)"
    Write-Host "安装包大小：$([math]::Round($installer.Length / 1MB, 2)) MB"
    Write-Host "安装包 SHA-256：$installerHash"
} else {
    Write-Host "构建产物目录：$(Join-Path $RepoRoot 'dist')"
}
Write-Host '说明：本脚本负责本机可自动化构建；实际 TUN 路由/DNS 行为仍需执行 docs\WINDOWS-ACCEPTANCE.md 验收。'
