# SSTap Next 0.3.13 — Batch node testing and per-node results

## Highlights

- Adds batch node checks directly to the node-management list: ICMP PING, TCPING, real proxy HTTP latency, download throughput and last-tested time.
- Supports test all nodes or selected nodes, per-node live updates and cancellation.
- Adds separate concurrency controls: simultaneous nodes 1/2/4/8/16/32 (default 4) and per-node HTTP Range threads 1/2/4/8/16/32.
- Caps aggregate active Range workers at 64 and rounds down to a supported thread tier for arbitrary node counts.
- Runs one isolated temporary sing-box process per batch (up to 32 nodes), with one loopback-only mixed inbound and node-pinned outbound per node. Unmatched routing is blocked.
- Never changes Windows system proxy settings and never switches or disconnects the user's active CoreController connection.
- Persists per-node results in encrypted user state and removes orphaned results when node records are deleted.
- Hysteria2 is marked TCPING not applicable because it uses UDP/QUIC.

## Architecture and safety

The batch runner is separate from the main CoreController. Each node's test SOCKS endpoint is bound to its own sing-box outbound by inbound tag. All test inbounds bind only to 127.0.0.1 and set_system_proxy is false. The main process rejects batch tests while TUN owns or is still cleaning up system networking. Cancellation waits for worker settlement and the owned sing-box process to exit before removing its temporary config; if process exit cannot be confirmed, the config is retained for diagnosis rather than falsely reporting cleanup success.

## Validation

The Windows build adds a real sing-box configuration check for a two-node test batch, increasing the config checks from 55 to 56. Node regression tests cover ICMP parsing (including Chinese Windows output), TCPING, Range worker budgeting, inbound-to-outbound pinning, worker concurrency, failure isolation and cancellation cleanup.

**Not covered by CI:** user-machine 1/2/4/8/16/32 concurrency stress testing (CPU, memory and shared bandwidth), proof that Windows system proxy remains unchanged, proof that an existing active connection is uninterrupted, and physical cleanup verification on Windows 10/11. These remain explicit acceptance items and must not be treated as passed until tested on the user's device.
