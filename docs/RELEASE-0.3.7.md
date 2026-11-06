# SSTap Next 0.3.7 — Wintun cleanup false-positive fix

## Bug evidence

The user observed the following after a long-running TUN session was stopped:

```text
sing-box PID 24372 已退出，但 TUN 接口 SSTap Next 在 18 秒后仍被检测为本次会话残留。
Description=sing-tun Tunnel #3
Status=Down
Addresses=[]
```

In 0.3.6, `IsSessionResidualAdapter()` returned true whenever a same-name adapter existed and no pre-start adapter snapshot had been recorded. This classified a persistent but inactive Windows Wintun adapter object as a cleanup leak.

## Change

- Added `IsAdapterOperationallyActive()`: active means the interface is `Up` or still carries the configured TUN address `172.19.0.1`.
- `IsSessionResidualAdapter()` now ignores a Down interface with no TUN address, even if Windows retains its adapter object.
- The retained adapter is preserved, not deleted. Successful cleanup logs explicitly describe the persistent inactive Wintun object.
- `Up` adapters and adapters still holding the TUN address remain protected and continue to block a new TUN session.
- Added source-contract regression tests for both the safe inactive case and the still-blocking active case.
- Added a Windows GitHub Actions release workflow that attaches installer, blockmap and SHA-256 when a version tag is published as a GitHub Release.

## Verification

The exact 0.3.6 source ZIP was verified before modification (ZIP SHA-256: `b70b21007945704573beb8019689e52eaee7303f77741e44bad699a849df1b5d`; 73/73 manifest entries matched; ZIP integrity test passed). The 0.3.6 baseline Node suite passed 65/65 before changes.

0.3.7 verification is recorded separately in `SSTapNext-0.3.7-BUILD-REPORT.md`. Windows Agent compilation, real sing-box checks, NSIS build and repeated live TUN cycles are not claimed unless run on Windows/Actions.
