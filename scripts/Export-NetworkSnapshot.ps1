[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('before', 'after', 'manual')][string]$Label
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path $env:LOCALAPPDATA 'SSTapNext\Diagnostics'
$target = Join-Path $root ("network-$Label-$stamp")
New-Item -ItemType Directory -Force -Path $target | Out-Null

route.exe print | Out-File -LiteralPath (Join-Path $target 'route-print.txt') -Encoding utf8
ipconfig.exe /all | Out-File -LiteralPath (Join-Path $target 'ipconfig-all.txt') -Encoding utf8
Get-NetAdapter -IncludeHidden | Sort-Object InterfaceIndex | Select-Object Name,InterfaceDescription,InterfaceIndex,Status,MacAddress,LinkSpeed,Virtual | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'adapters.json') -Encoding UTF8
Get-NetIPInterface | Sort-Object InterfaceIndex,AddressFamily | Select-Object InterfaceIndex,InterfaceAlias,AddressFamily,ConnectionState,Dhcp,InterfaceMetric,AutomaticMetric | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'ip-interfaces.json') -Encoding UTF8
Get-NetRoute -PolicyStore ActiveStore | Sort-Object DestinationPrefix,InterfaceIndex,NextHop,RouteMetric | Select-Object DestinationPrefix,InterfaceIndex,InterfaceAlias,NextHop,RouteMetric,Protocol,PolicyStore | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'routes.json') -Encoding UTF8
Get-DnsClientServerAddress | Sort-Object InterfaceIndex,AddressFamily | Select-Object InterfaceIndex,InterfaceAlias,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'dns.json') -Encoding UTF8
@"
Label: $Label
Captured: $(Get-Date -Format o)
Computer: $env:COMPUTERNAME
User: $env:USERNAME
PowerShell: $($PSVersionTable.PSVersion)
"@ | Set-Content -LiteralPath (Join-Path $target 'metadata.txt') -Encoding UTF8
Write-Host "网络快照已保存：$target" -ForegroundColor Green
