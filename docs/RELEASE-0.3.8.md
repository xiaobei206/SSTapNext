# SSTap Next 0.3.8 — safe recovery of inactive Wintun residue

## Fix: upgrades blocked by a historical cleanup_error

- The 0.3.7 Agent correctly classifies a retained Wintun object as released when it is Down and has no unicast addresses, but the desktop recovery path could reject the saved 0.3.6/0.3.7 cleanup_error before the new Agent was started.
- Added a read-only Agent command that inspects a network adapter by the exact GUID saved in the previous diagnostic. It performs no route, DNS, adapter, or driver changes and does not require elevation.
- The desktop recovery path only bypasses the old cleanup lock when all evidence agrees: the previous Agent recorded sing-box as exited with a null core PID; the previous diagnostic identifies the same adapter GUID as Name=SSTap Next, Description beginning with sing-tun Tunnel, Status=Down, Addresses=[]; and a fresh Agent inspection confirms that exact adapter is still Down with no unicast addresses and is not operationally active.
- The old cleanup_error status, session metadata, and logs are preserved. A recovery marker records the read-only check. The adapter is never deleted.
- Missing/malformed evidence, a changed GUID, an ambiguous/missing adapter, address-enumeration failure, an Up adapter, or any assigned address keeps the startup lock in place.

## Main window

- Added a dedicated lower-left sidebar version label, shown as v0.3.8.
- The renderer reads the version from package.json at build time so it cannot silently drift from the installer version.

## Verification

- Added regression tests for the exact 0.3.6/0.3.7 inactive-adapter false-positive and for fail-closed behavior when the same adapter is active.
- GitHub Actions Windows build compiles the .NET 10 Agent and packages the NSIS installer. This build does not replace real Windows TUN acceptance: verify the user's previously blocked recovery scenario, then perform controlled connect/disconnect cycles only after the stale state is safely classified.
