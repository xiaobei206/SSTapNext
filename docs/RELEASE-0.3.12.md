# SSTap Next 0.3.12

## SSTap legacy rule library

- Add a tested converter for original FQrabbit/SSTap-Rule text files.
- Preserve the original route action field: `0 = proxy`, `1 = direct`.
- Validate IPv4 and IPv6 CIDRs, deduplicate repeated entries, and reject malformed source files instead of installing partial results.
- Download a commit-pinned upstream ZIP, verify entry sizes and CRC-32, convert to sing-box local source JSON rule sets, and atomically switch the active version pointer.
- Add the rule library manager to the routing page with search, per-rule enable/disable, action labels, CIDR counts and an in-app update button.
- In China-bypass mode, automatically add the upstream `BypassCNandLan.rules` when installed, while retaining MetaCubeX GeoSite/GeoIP fallback.
- Keep game-specific rules ahead of broad China GEO routes so their explicit action takes precedence.
- Store rules separately from the application installation; subsequent rule data updates do not require an SSTap Next rebuild.

## Compatibility and safety

- No Wintun/TUN cleanup behavior is changed.
- Rule updates and selection changes are blocked while TUN is active or transitioning.
- Failed downloads, ZIP validation, parsing or conversion do not replace the active rule library.
- Preserve the previous rule-library revisions and include the upstream Apache-2.0 license.

## Validation

The release workflow runs the complete Node regression suite, package-lock validation, Windows .NET Agent build, sing-box configuration checks, TypeScript/Vite build and NSIS packaging before publishing the installer.
