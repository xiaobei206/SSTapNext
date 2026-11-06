[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$SessionPath
)
$ErrorActionPreference = 'Stop'
$AgentPath = [System.IO.Path]::GetFullPath($AgentPath)
$SessionPath = [System.IO.Path]::GetFullPath($SessionPath)
if (-not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) { throw "未找到 SSTap Next Agent：$AgentPath" }
if (-not (Test-Path -LiteralPath (Join-Path $SessionPath 'session.json') -PathType Leaf)) { throw '会话配置不存在。' }

function Quote-Argument([string]$Value) {
    $builder = [System.Text.StringBuilder]::new('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * ($slashes * 2 + 1))).Append('"')
            $slashes = 0
            continue
        }
        [void]$builder.Append(('\' * $slashes)).Append($character)
        $slashes = 0
    }
    [void]$builder.Append(('\' * ($slashes * 2))).Append('"')
    return $builder.ToString()
}

$arguments = @('--tun-run', '--session', $SessionPath) | ForEach-Object { Quote-Argument $_ }
$process = Start-Process -FilePath $AgentPath -Verb RunAs -WindowStyle Hidden -ArgumentList ($arguments -join ' ') -PassThru
[Console]::Out.WriteLine($process.Id)
