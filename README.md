# SSTap Next 0.3.7 — Windows TUN cleanup reliability fix

SSTap Next is a Windows desktop proxy client built with Electron + React/TypeScript, a .NET 10 elevated Agent, and sing-box. It provides loopback SOCKS/HTTP proxy mode and Windows system-wide TUN mode.

## 0.3.7 changes

- Fixes a false `cleanup_error` after sing-box exits when Windows keeps the Wintun adapter object installed but inactive (`Status=Down`, no `172.19.0.1` address).
- Treats an adapter as an active session residual only while it is `Up` or still owns the SSTap Next TUN address. The program does not delete the persistent adapter object.
- Keeps the safety lock for an `Up` adapter or an adapter that still has the TUN address.
- Adds a Windows GitHub Actions release workflow. Publishing a `vX.Y.Z` GitHub Release tag builds the installer on Windows and attaches the installer, blockmap and SHA-256 file.

## Build on Windows 10/11 x64

Requirements: Node.js 22+, .NET 10 SDK, PowerShell 7 (recommended) or Windows PowerShell 5.1.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

The script installs npm dependencies, runs the Node regression tests, verifies 54 sing-box protocol/mode/DNS configurations using the pinned sing-box core, publishes the self-contained .NET Agent, builds TypeScript/Vite and creates the NSIS installer under `release\`.

## GitHub Releases

Create a GitHub Release with a tag matching the project version, for example `v0.3.7`. The workflow in `.github/workflows/release-windows.yml` builds on `windows-2022` and attaches:

- `SSTap Next-0.3.7-x64.exe`
- `SSTap Next-0.3.7-x64.exe.blockmap`
- `SSTap Next-0.3.7-x64.exe.sha256`

The GitHub-generated source ZIP/TAR for the tag is also available from the Release page. The workflow does not publish user node profiles, subscription URLs, runtime session files, or credentials.

## Network safety

- TUN start/stop and route/DNS changes are owned by the elevated .NET Agent and sing-box.
- An active TUN interface (`Up`) or one still holding `172.19.0.1` remains a blocking cleanup residual.
- An inactive Wintun device object (`Down`, no TUN address) may remain installed by Windows after the session closes; it is not deleted and no longer blocks a new session.
- Do not manually delete network adapters or reset Windows networking to bypass a `cleanup_error`.

See `docs/WINDOWS-ACCEPTANCE.md`, `docs/TUN-SAFETY-CHECKLIST.md`, and `HANDOVER.md`.
