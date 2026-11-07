# SSTap Next 0.3.16 — live traffic statistics + TUN allowlist fix

> **新对话 / 新 GPT 接手必读：** [START HERE NEXT GPT.md](START%20HERE%20NEXT%20GPT.md)。该文件是仓库第一入口，写有当前版本、实际 Release 状态、架构、安全边界、未完成验收和下一步。
>
> **开发纪律：** 这是个人项目，只在 main 开发，不建立日常 feature 分支或 PR。所有开发必须先更新文档，再修改代码；上下文即将结束时先补齐交接记录。

Latest published release: **0.3.15** ([GitHub Release](https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.15)). Main target: **0.3.16**, which fixes the TUN Agent rejecting the loopback-only Clash API; do not treat v0.3.15 as fixed for system TUN traffic statistics.

SSTap Next is a Windows desktop proxy client built with Electron + React/TypeScript, a .NET 10 elevated Agent, and sing-box. It provides loopback SOCKS/HTTP proxy mode and Windows system-wide TUN mode.

## 0.3.16 hotfix in progress

- Fixes the elevated TUN Agent allowlist to permit only the per-session Clash API bound to `127.0.0.1:<valid port>` with a 64-hex random secret and exactly two fields: `external_controller` and `secret`.
- Continues to reject root-level `endpoints`, extra or duplicate Clash API fields, LAN / wildcard / IPv6 listeners, invalid ports and malformed secrets.
- Keeps the existing TUN route, DNS, config hash, session path, Wintun cleanup and fail-closed restrictions unchanged.
- Full Node CI, sing-box 58/58 config validation, .NET Agent, TypeScript/Vite, NSIS, installer, blockmap and SHA checks are pending this version's build. Real Windows TUN acceptance remains NOT RUN.

## 0.3.15 changes

- Adds live upload/download rates and separate per-session upload/download totals through the pinned sing-box Clash API.
- Adds encrypted per-node upload/download/total history for local-proxy traffic only; TUN session totals explicitly include direct traffic and are not assigned to a selected node.
- Makes PING, TCPING, proxy latency, download rate, upload/download/total traffic and last-test headers sortable.
- Reduces sidebar version label emphasis and sets HTML small text to at least 14px.
- CI: 107/107 tests and 704/704 lock references passed; Windows build: 58/58 sing-box config checks, .NET Agent, TypeScript/Vite, NSIS, installer and SHA verification passed. Real Windows proxy/TUN behavior still requires user-device acceptance.

## 0.3.13 changes

- Adds batch PING, TCPING, real proxy latency and download throughput directly in the node-management list.
- Supports test-all / selected nodes, per-node live updates, cancellation, and concurrency choices 1/2/4/8/16/32.
- Uses one isolated sing-box process per batch, with loopback-only inbound endpoints pinned to each node outbound. The test runner never changes the Windows system proxy or switches the user's active connection.
- Caps aggregate HTTP Range workers at 64 and persists per-node results in encrypted application state.

## 0.3.12 changes

- Imports the original FQrabbit/SSTap-Rule \`.rules\` format and converts each rule into a sing-box local source JSON rule set.
- Preserves the original rule header route action: \`0 = proxy\`, \`1 = direct\`; validates every IPv4/IPv6 CIDR and rejects partially malformed files.
- Adds an in-app **Check and update rule library** action. The app downloads an upstream commit-pinned ZIP, validates its ZIP CRCs, converts rules, and atomically switches the active local rule library. Rule data updates do not require a new app build or installer.
- The routing page lists searchable game rules with their default action and CIDR counts. Enabled rules are stored in the encrypted user settings.
- The China bypass mode can add the upstream \`BypassCNandLan.rules\` as a local direct rule while retaining the existing MetaCubeX GeoSite/GeoIP rules as domain/IP fallback.
- Game rule sets are evaluated before the broad China GEO route so a selected game-specific proxy rule can take precedence.

## Rule library details

- Upstream: https://github.com/FQrabbit/SSTap-Rule
- License: Apache-2.0; the upstream license is copied to \`docs/third-party/FQrabbit-SSTap-Rule-LICENSE.txt\` and included with each downloaded rule-library revision.
- Converter and update design: [docs/SSTAP-RULE-CONVERSION.md](docs/SSTAP-RULE-CONVERSION.md)
- Downloaded and converted files live under the current Windows user's SSTap Next application-data directory, not in the installation folder.
- The app retains previous library revisions and only switches the current pointer after the complete rule package passes validation.

## Build on Windows 10/11 x64

Requirements: Node.js 22+, .NET 10 SDK, PowerShell 7 (recommended) or Windows PowerShell 5.1.

\`\`\`powershell
Set-ExecutionPolicy -Scope Process Bypass
.\\scripts\\Build-Windows.ps1
\`\`\`

The script installs npm dependencies, runs the Node regression tests, verifies the sing-box protocol/mode/DNS configurations using the pinned sing-box core, publishes the self-contained .NET Agent, builds TypeScript/Vite and creates the NSIS installer under \`release\\\`.

## GitHub Actions

Pushing to \`main\` runs Node regression tests and the Windows build workflow. For a new version, the Windows workflow creates the matching \`vX.Y.Z\` GitHub Release and attaches the Windows x64 installer, blockmap and SHA-256 file.

## Network safety

- TUN start/stop and route/DNS changes are owned by the elevated .NET Agent and sing-box.
- An active TUN interface or one still holding the SSTap TUN address remains a blocking cleanup residual.
- Rule-library updates and changes to enabled rule selections are blocked while system TUN is active or transitioning.
- Do not manually delete network adapters or reset Windows networking to bypass a \`cleanup_error\`.


## 0.3.14 maintenance

A Windows ICMP parsing regression was confirmed by a real PowerShell comparison: native ping to `65.49.237.84` returned three replies (45/43/43 ms), while the 0.3.13 node list showed a timeout. The 0.3.14 maintenance release makes RTT parsing independent of localized text prefixes and adds a regression test for garbled OEM-codepage text. Installer: [https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.14/SSTap.Next-0.3.14-x64.exe](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.14/SSTap.Next-0.3.14-x64.exe). This fix does not change proxy routing or Windows system proxy behavior.
