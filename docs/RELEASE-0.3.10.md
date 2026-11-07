# SSTap Next 0.3.10

## TUN legacy cleanup recovery

- Independently enumerate Windows network interfaces through PowerShell and the .NET Agent.
- Retire an old cleanup lock when both enumerators confirm that the recorded adapter GUID and all SSTap/sing-tun related interfaces are absent, and the historical sing-box PID is no longer running.
- Continue blocking recovery if any related adapter remains, an interface is active/addressed, the historical sing-box PID is still running, or either inspection is incomplete or ambiguous.
- Preserve the original cleanup_error status and existing logs. No adapter, driver, route, or DNS entry is deleted or reset.

## Installer

The Windows x64 installer is attached to this GitHub Release after the Windows build and regression checks complete.
