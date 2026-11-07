# SSTap Next 0.3.11

## TUN cleanup recovery

- Recognize Windows `NotPresent` Wintun/sing-tun interface objects as inactive when the complete enumerations show no IP addresses.
- Recover a legacy cleanup lock only when PowerShell and the .NET Agent both complete their interface enumeration, every SSTap/sing-tun related adapter is Down/Disconnected/NotPresent and unaddressed, and the historical sing-box PID is not running.
- Keep blocking startup when any related adapter is active, owns an IP address, has an unknown/unreadable state, or process/interface inspection is incomplete.
- Preserve the legacy status and original logs. Do not delete adapters/drivers or change routes/DNS.

The Windows x64 installer is attached to this GitHub Release after automated tests and Windows packaging pass.
