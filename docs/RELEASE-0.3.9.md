# SSTap Next 0.3.9 — retire verified inactive TUN cleanup locks

## Fix the stale cleanup_error that survived 0.3.8

- Recovery now queries Windows' built-in NetAdapter cmdlets, including hidden adapters, matching the exact historical InterfaceGuid, then checks all IP addresses on that interface. If the cmdlets are unavailable or cannot locate the exact GUID, it falls back to the read-only .NET Agent inspection.
- Recovery only accepts the exact SSTap Next / sing-tun Tunnel adapter GUID, a historical sing-box-exited diagnostic, and a current Down/Disconnected state with no IP addresses or 172.19.0.1 address. Unknown, missing, changed, active or partially inspected adapters remain blocked.
- Once confirmed inactive, the old cleanup_error is genuinely retired: original status is archived as status.cleanup_error-legacy.json, current status is rewritten to stopped_with_warning, and normal recovery removes stale session/stop/heartbeat/config metadata. Original sing-box and Agent logs remain. The Wintun device object itself is never deleted.
- Successful recovery publishes a clean disconnected status so the previous red banner is not reloaded.

## UI

- The left sidebar is pinned to viewport height, keeping the v0.3.9 version label visible on long pages such as Connection Center and Node Management.
- The Home page's outdated version badge is replaced with a functional TUN recovery label; the authoritative app version remains in the lower-left sidebar.

## Verification

- Updated regression test verifies that an inactive historical cleanup_error is archived and stale session metadata is retired while the sing-box log remains untouched.
- Active-adapter fail-closed regression remains.
- Windows Actions compiles the .NET 10 Agent and creates the installer. It does not replace acceptance on the user's actual Windows adapter.
