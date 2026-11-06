# SSTap Next 0.3.7 — handoff

## Current baseline

- Longitudinal project history: `PROJECT-DEVELOPMENT-LOG-CN.md` (repository-root file; deliberately maintained outside version source archives so it can record each archive SHA-256 without a self-referential checksum).
- Project overview: `PROJECT-OVERVIEW-CN.md`.

- Version: `0.3.7`
- Baseline: verified `SSTapNext-0.3.6-source.zip` (SHA-256 `b70b21007945704573beb8019689e52eaee7303f77741e44bad699a849df1b5d`), then a narrowly scoped change to TUN adapter cleanup classification and release automation.
- Architecture: Electron main/preload + React/TypeScript renderer; shared Node CJS modules; .NET 10 Windows Agent; sing-box 1.14.4; Wintun TUN inbound.
- User-facing successful baseline: user confirmed 0.3.5 system TUN could access YouTube; 0.3.6 introduced dual-stack DNS options, resilient speed-test source fallback, improved button feedback, manual sing-box core upgrade instructions and larger fonts. Windows build of 0.3.6 was not reported as complete.

## 0.3.7 root cause and fix

The previous `IsSessionResidualAdapter()` returned `true` for any matching adapter when no adapter existed before session startup. Windows can keep a Wintun network-interface object after sing-box closes its last session handle. The user's exact report showed: `Description=sing-tun Tunnel #3`, `Status=Down`, `Addresses=[]`. This is an inactive, unaddressed adapter object, not an active TUN route endpoint.

New rule: an adapter is considered operationally active only if `OperationalStatus == Up` OR it still has the configured SSTap TUN address `172.19.0.1`. Only active adapters can be treated as a session residual. A Down adapter with no TUN address is treated as released; it is preserved, never deleted. An Up adapter or one still holding the TUN address continues to cause `cleanup_error` and block restart.

## Important files

- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`: adapter snapshot, startup ownership check, stop/cleanup, `IsAdapterOperationallyActive`, `IsSessionResidualAdapter`, adapter diagnostics.
- `src/agent/SstapNext.Agent/Core/TunSmokeTest.cs`: isolated Wintun smoke test; does not use system route/DNS takeover by default.
- `src/agent/SstapNext.Agent/Core/ProcessRunner.cs`: sing-box child process and CTRL_BREAK graceful stop.
- `src/shared/tun-controller.cjs`: desktop-side session state, legacy cleanup recovery and stop signaling.
- `src/shared/tun-config.cjs`: sing-box TUN/DNS/routing configuration.
- `src/shared/agent-stop-contract.test.mjs`: regression source contracts for process stop and adapter cleanup classification.
- `scripts/Build-Windows.ps1`: full Windows build pipeline.
- `.github/workflows/release-windows.yml`: build installer and attach it to published GitHub Releases.

## Build and test

Run in the project root on Windows 10/11 x64 with Node 22+ and .NET 10 SDK:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

Expected installer: `release\SSTap Next-0.3.7-x64.exe`. The build script runs Node tests, package-lock validation, 54 real sing-box configuration checks, .NET Agent publish, TypeScript/Vite build, NSIS packaging and doctor.

Current environment limitations must be respected: this handoff generation environment does not have Windows, .NET 10 SDK, the Wintun driver or a Windows sing-box executable. No Agent compile, real sing-box config check, NSIS package or real Windows TUN test is claimed here.

## Safety constraints

- Never delete Wintun/TAP/network adapters to suppress an error.
- Never disable Defender/firewall or reset routes/DNS as a generic fix.
- Do not weaken protection for `Up` adapters or adapters still holding `172.19.0.1`.
- Keep user settings in `%APPDATA%\SSTap Next`; do not version the user-data directory.
- Never publish real node URI, password, subscription URL, `state.enc.json`, `session.json` or runtime configs.
- Keep sing-box version pinned unless separately audited; manual core replacement must include matching DLLs.

## GitHub publishing

Recommended public repository: `xiaobei206/SSTapNext`. The authenticated GitHub login is `xiaobei206`. A repository lookup for `xiaobei206/SSTapNext` returned 404, and the connector exposes no create-repository operation. Do not push to an unrelated repository. The owner must first create an empty **Public** repository named `SSTapNext` at https://github.com/new?name=SSTapNext&visibility=public (leave README/.gitignore/license unchecked). Then provide the repository URL; source upload can proceed. After the source is committed, publish a Release tagged `v0.3.7`; `.github/workflows/release-windows.yml` builds on Windows and uploads the installer, blockmap and SHA-256. Later releases follow the same `vX.Y.Z` tag convention.
