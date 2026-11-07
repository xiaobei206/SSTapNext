# SSTap legacy rule conversion

## Upstream source and license

- Repository: https://github.com/FQrabbit/SSTap-Rule
- Runtime update source: commit API at https://api.github.com/repos/FQrabbit/SSTap-Rule/commits/master, followed by the commit-pinned source ZIP from codeload.github.com.
- License: Apache License 2.0. The upstream license is copied to `docs/third-party/FQrabbit-SSTap-Rule-LICENSE.txt`; the updater also stores the downloaded upstream LICENSE beside each converted revision.

## Original format findings

The upstream archive contains a `rules/` directory with roughly 190 `.rules` files. Files are UTF-8 comma-separated header metadata followed by one IP CIDR per line. The first non-empty line begins with `#`. For example:

```text
#League-of-Legends-us,英雄联盟-美服,0,0,1,0,1,0,By-FQrabbit
8.23.24.0/24
23.119.209.0/24
```

The third header field (zero-based field index 2) defines the route action:

- `0`: proxy
- `1`: direct

The converter does not guess or reinterpret other legacy header flags. It retains those values as metadata (read-only hint, DNS proxy type, author) but only the routing action is translated into sing-box. This avoids accidentally inverting a rule's intended behavior.

A concrete analysis of the upstream examples found:

- `BypassCNandLan.rules`: 7,064 unique IPv4 CIDRs, default direct.
- `BypassCNandLan_someip.rules`: 6,963 IPv4 CIDRs and three IPv6 CIDRs, default direct.
- `League-of-Legends-us.rules`: 556 unique CIDRs, default proxy.
- `League-of-Legends-tw.rules`: 1,440 unique CIDRs, default proxy.

## Conversion algorithm

1. Read the archive's ZIP central directory; reject multi-disk/ZIP64/encrypted/unsupported entries and unsafe paths.
2. Extract only `rules/**/*.rules` and the root `LICENSE`; verify each extracted file against the ZIP CRC-32 and declared size.
3. Decode UTF-8 strictly, strip an optional BOM, locate the header, require the third field to be exactly `0` or `1`.
4. Validate every non-empty data row with Node's IP parser and CIDR prefix limits (IPv4 0–32; IPv6 0–128). Missing prefixes become /32 or /128.
5. De-duplicate identical CIDR strings. Any malformed CIDR rejects that entire source file rather than silently importing a partial rule.
6. Convert all CIDRs into a sing-box source rule-set document:

```json
{
  "version": 1,
  "rules": [
    { "ip_cidr": ["8.23.24.0/24", "23.119.209.0/24"] }
  ]
}
```

7. Assign a stable rule ID from the normalized upstream relative path, save the JSON under a commit-versioned directory, generate a manifest and only then atomically replace `current.json`.

## Runtime routing behavior

- The selected SSTap local source rule sets are injected into the sing-box `route.rule_set` list.
- `0` maps to `selected-proxy`; `1` maps to `direct`.
- Game/user-selected rule routes are inserted before the broad China GeoSite/GeoIP routes, so a selected game-specific proxy rule can override a general China-direct match.
- Private/local IP direct remains a safety rule before imported rules.
- In `bypass-cn` mode, the legacy `BypassCNandLan.rules` rule is auto-added if the library has been installed. Existing MetaCubeX `geosite-cn` and `geoip-cn` remain as remote fallback rules, including domain matching.

## Updating without rebuilding SSTap Next

The UI's rule update action fetches the newest upstream commit, downloads the commit-pinned ZIP, validates and converts files, installs a complete immutable revision under the user's application-data directory, then swaps the active pointer. Prior revisions are retained. If any mandatory file, archive CRC, format, or conversion check fails, the previous `current.json` remains untouched.

The software executable and the rule data are separate: subsequent rule-library updates do not require an SSTap Next source change, version bump, compilation or installer.
