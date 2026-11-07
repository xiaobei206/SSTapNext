# SSTap Next 0.3.12 — developer handover

## Current baseline

- Version: `0.3.12`
- Previous verified release: `0.3.11`; 0.3.12 is the SSTap legacy rule-library implementation.
- Architecture: Electron main/preload + React/TypeScript renderer; shared Node CJS modules; .NET 10 Windows Agent; sing-box 1.14.x; Wintun TUN inbound.
- Feature branch during implementation: `feature/sstap-rule-library-0312`. Merge to `main` only after CI and Windows build pass.
- Main release workflow: `.github/workflows/windows-build.yml`; commits to main run the Windows build and create `v0.3.12` Release if absent.

## SSTap legacy rules

- Upstream: `FQrabbit/SSTap-Rule`, Apache-2.0.
- Source format: UTF-8 `.rules` text. The first non-empty line is a comma-delimited header. Third field is the default routing action: `0=proxy`, `1=direct`; remaining lines contain IPv4/IPv6 CIDRs.
- Converter: `src/shared/sstap-rule-parser.cjs`.
- Download, ZIP verification, conversion, versioned storage and active pointer: `src/shared/sstap-rule-library.cjs`.
- Conversion format: sing-box local source rule set, `{ "version": 1, "rules": [{ "ip_cidr": [...] }] }`.
- Runtime storage: `%APPDATA%\SSTap Next\rules\sstap-rule-library\versions\<commit-sha>\`; `current.json` points to the active revision.
- UI: `apps/desktop/src/renderer/src/main.tsx` / `style.css`; bridge: `apps/desktop/src/preload/index.cjs`; IPC and encrypted settings: `apps/desktop/src/main/index.cjs`.
- TUN integration: `src/shared/tun-controller.cjs` loads selected local rules at session creation. Route order is DNS hijack/sniff → private/LAN direct → user-selected SSTap game rules → automatic `BypassCNandLan.rules` in bypass-cn mode → MetaCubeX GeoSite/GeoIP fallback → final proxy. The automatic broad CN table must remain after selected game rules so an overlapping CIDR cannot defeat an explicit game Proxy rule.
- China bypass retains existing remote MetaCubeX `geosite-cn` and `geoip-cn`; if a rule library is installed, legacy `BypassCNandLan.rules` is auto-added after explicitly selected game rules when mode is `bypass-cn`.
- Selected rule IDs are persisted in encrypted app settings. During an update, IDs no longer present upstream are pruned.
- Rule-library update, routing-setting changes and TUN startup use a fail-closed mutual-exclusion boundary. The controller lock covers in-flight recovery/start/stop promises, retained sessions and requested/awaiting_uac/starting/running/stopping/cleanup_error statuses. While an update is in progress, TUN connect is rejected; while TUN is active or cleanup is unresolved, rule updates and routing-setting changes are rejected. The renderer disables the corresponding controls, but Electron main/controller checks are authoritative. A failed download/conversion does not replace the current pointer; prior revisions are retained.

## Key implementation files

- `src/shared/sstap-rule-parser.cjs`: original SSTap header + CIDR parsing and conversion.
- `src/shared/sstap-rule-library.cjs`: ZIP parser (store/deflate), CRC validation, updater, atomic version pointer and selected local source rules.
- `src/shared/zip-test-fixture.mjs`, `zip-reader.test.mjs`, `sstap-rule-parser.test.mjs`, `sstap-rule-library.test.mjs`: converter/updater tests.
- `src/shared/tun-config.cjs`: local rule-set descriptors and route precedence.
- `src/shared/tun-controller.cjs`: load active local rules before writing each TUN session config.
- `docs/SSTAP-RULE-CONVERSION.md`: format mapping, converter, updater and fallback behavior.
- `docs/third-party/FQrabbit-SSTap-Rule-LICENSE.txt`: upstream license copy.

## Build and validation

On Windows 10/11 x64 with Node 22+ and .NET 10 SDK:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

The Windows build script runs Node tests, 54 protocol/mode/DNS sing-box combinations plus one actual local SSTap source-rule-set configuration (Proxy + Direct), .NET Agent publish, TypeScript/Vite build, NSIS packaging and doctor. Confirm the test counts and installer SHA-256 from the actual workflow; do not claim local Windows TUN acceptance from CI alone.

## Safety constraints

- Do not delete Wintun/network adapters, drivers, routes or reset DNS to bypass cleanup errors.
- Keep all current fail-closed cleanup protections.
- Never publish user node URI, password, subscription URL, encrypted state, session files or runtime configs.
- Keep sing-box version pinned unless separately audited.
- Do not perform rule-library updates or change routing settings while TUN is recovering/starting/running/stopping or in cleanup_error; do not start TUN while a rule-library update is running.
- The app must retain the last valid rule library when upstream download, extraction, parse or validation fails.
