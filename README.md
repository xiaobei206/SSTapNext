# SSTap Next 0.3.12 — Windows TUN + live SSTap rules

SSTap Next is a Windows desktop proxy client built with Electron + React/TypeScript, a .NET 10 elevated Agent, and sing-box. It provides loopback SOCKS/HTTP proxy mode and Windows system-wide TUN mode.

## 0.3.12 changes

- Imports the original FQrabbit/SSTap-Rule `.rules` format and converts each rule into a sing-box local source JSON rule set.
- Preserves the original rule header route action: `0 = proxy`, `1 = direct`; validates every IPv4/IPv6 CIDR and rejects partially malformed files.
- Adds an in-app **Check and update rule library** action. The app downloads an upstream commit-pinned ZIP, validates its ZIP CRCs, converts rules, and atomically switches the active local rule library. Rule data updates do not require a new app build or installer.
- The routing page lists searchable game rules with their default action and CIDR counts. Enabled rules are stored in the encrypted user settings.
- The China bypass mode can add the upstream `BypassCNandLan.rules` as a local direct rule while retaining the existing MetaCubeX GeoSite/GeoIP rules as domain/IP fallback.
- Game rule sets are evaluated before the broad China GEO route so a selected game-specific proxy rule can take precedence.

## Rule library details

- Upstream: https://github.com/FQrabbit/SSTap-Rule
- License: Apache-2.0; the upstream license is copied to `docs/third-party/FQrabbit-SSTap-Rule-LICENSE.txt` and included with each downloaded rule-library revision.
- Converter and update design: [docs/SSTAP-RULE-CONVERSION.md](docs/SSTAP-RULE-CONVERSION.md)
- Downloaded and converted files live under the current Windows user's SSTap Next application-data directory, not in the installation folder.
- The app retains previous library revisions and only switches the current pointer after the complete rule package passes validation.

## Build on Windows 10/11 x64

Requirements: Node.js 22+, .NET 10 SDK, PowerShell 7 (recommended) or Windows PowerShell 5.1.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

The script installs npm dependencies, runs the Node regression tests, verifies the sing-box protocol/mode/DNS configurations using the pinned sing-box core, publishes the self-contained .NET Agent, builds TypeScript/Vite and creates the NSIS installer under `release\`.

## GitHub Actions

Pushing to `main` runs Node regression tests and the Windows build workflow. The Windows workflow creates the matching `vX.Y.Z` GitHub Release and attaches the Windows x64 installer, blockmap and SHA-256 file if that version has not already been released.

## Network safety

- TUN start/stop and route/DNS changes are owned by the elevated .NET Agent and sing-box.
- An active TUN interface or one still holding the SSTap TUN address remains a blocking cleanup residual.
- Rule-library updates and changes to enabled rule selections are blocked while system TUN is active or transitioning.
- Do not manually delete network adapters or reset Windows networking to bypass a `cleanup_error`.
