[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $RepoRoot 'src\agent\SstapNext.Agent\SstapNext.Agent.csproj'
$RuntimeCore = Join-Path $RepoRoot 'runtime\sing-box\sing-box.exe'
$PublishDir = Join-Path $RepoRoot 'artifacts\agent-win-x64'

if (-not (Test-Path -LiteralPath $RuntimeCore)) {
    throw '未找到 runtime\sing-box\sing-box.exe。请先运行 scripts\Fetch-SingBox.ps1。'
}

Write-Host '发布 SSTap Next Agent（win-x64，自包含）...' -ForegroundColor Cyan
dotnet publish $Project -c Release -r win-x64 --self-contained true -o $PublishDir 2>&1
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 失败。' }

$AgentRuntime = Join-Path $PublishDir 'runtime\sing-box'
New-Item -ItemType Directory -Force -Path $AgentRuntime | Out-Null
Copy-Item -Path (Join-Path (Split-Path -Parent $RuntimeCore) '*') -Destination $AgentRuntime -Recurse -Force

$Agent = Join-Path $PublishDir 'SstapNext.Agent.exe'
if (-not (Test-Path -LiteralPath $Agent)) { throw '发布结果中没有 SstapNext.Agent.exe。' }
$env:SSTAP_SING_BOX = $RuntimeCore

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    & $Agent --tun-smoke-test 2>&1
    exit $LASTEXITCODE
}

Write-Host '即将请求 UAC 管理员权限。自检只创建测试网卡，不会设置默认路由。' -ForegroundColor Yellow
$process = Start-Process -FilePath $Agent -ArgumentList '--tun-smoke-test' -Verb RunAs -Wait -PassThru -ErrorAction SilentlyContinue
if (-not $process) {
    Write-Error 'UAC 提权被取消或失败；未运行 smoke test。'
    exit 1223
}
exit $process.ExitCode
