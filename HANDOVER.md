# SSTap Next — 当前交接摘要（2026-11-07）

> 本节优先级高于下方保留的 0.3.12/早期历史交接内容。正式发布基线为 0.3.13，当前 PING 修复目标为 0.3.14。

- 仓库：`xiaobei206/SSTapNext`；唯一开发线 main；不使用日常 feature branch/PR；先文档后代码。
- 最新正式 Release：v0.3.13，https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.13；Release commit `9d733967fb8c1280da6a1603b7ab9f733da6eccf`。
- 当前 main 基线（本轮文档变更前）：`6f77a31d439aaac8a1c173198b570dc271cff85b`；package version 0.3.13。
- 批量检测功能已在 0.3.13 发布：每批一个临时 sing-box、节点 loopback inbound/outbound 隔离、PING/TCPING/代理延迟/下载、节点并发 1/2/4/8/16/32；不修改 Windows 系统代理，不切换/断开现用主连接。

## 当前已确认缺陷：PING 全部显示超时

用户在 2026-11-07 提供 0.3.13 列表中 36 个节点 PING 全部超时的结果，并在同一 Windows PowerShell 终端执行：

```powershell
ping -n 3 -w 1000 65.49.237.84
```

系统返回三次成功：45ms、43ms、43ms，0% 丢包，平均 43ms。因此客户端结果是误报，不能再归因于该节点/服务器统一屏蔽 ICMP。

源码定位：`src/shared/batch-node-test.cjs` 的 `parseIcmpOutput()` 只匹配 `time=...ms` 或 `时间=...ms`；`runIcmpPing()` 将子进程 chunk 直接用 UTF-8 解码。Windows ping 的中文输出可能使用系统 OEM 代码页，中文前缀解码乱码后正则漏掉有效 RTT，最后被归类为 timeout。

### 0.3.14 修复方案（本节记录在改代码之前）

1. RTT 改为不依赖语言前缀，识别 `[=<]\\s*(\\d+(?:\\.\\d+)?)\\s*ms`。Windows 英文 `time=43ms`、中文 `时间=43ms` 和乱码前缀后的 `=43ms` 均可解析；`<1ms` 仍计为 1ms。
2. 保留丢包、域名解析失败、真实 timeout 和取消时等待 ping 子进程 close 的现有语义。
3. 回归测试增加“乱码中文前缀 + ASCII RTT”的输入，并保留完整中英文、丢包、完全超时及取消用例。
4. 版本升至 0.3.14；先文档后代码；同步 VERSION/package/package-lock/Agent/构建/UI显示中真实存在的版本源与 release docs。不得覆盖 v0.3.13。
5. 0.3.14 验证：Node 全量测试、lock、sing-box 56 项、Windows Agent/TS/Vite/NSIS；用户实机对 65.49.237.84 确认约 43ms。

安全边界不变：不修改系统代理，不动主 CoreController/TUN 生命周期，不触碰用户订阅/节点秘密；不把 CI 作为实机验收替代。

---

# SSTap Next 0.3.12 — developer handover

## Current baseline

- Version: `0.3.12`
- Release: `v0.3.12` is the SSTap legacy rule-library implementation; the canonical source is the `main` branch.
- Architecture: Electron main/preload + React/TypeScript renderer; shared Node CJS modules; .NET 10 Windows Agent; sing-box 1.14.x; Wintun TUN inbound.
- Development workflow: this is a solo project. Work directly on `main`; do not create feature branches or PRs for routine development. Make focused commits on `main`, bump the app version for each formal release, and let GitHub Actions build/publish. Use GitHub Revert to roll back a bad commit; do not rewrite history.
- Main release workflow: `.github/workflows/windows-build.yml`; a `main` push runs validation and the Windows build. When the version's Release does not exist, a successful build creates the matching `vX.Y.Z` tag and GitHub Release with installer, blockmap and SHA-256. A direct version-tag push is also supported.

## SSTap legacy rules

- Upstream: `FQrabbit/SSTap-Rule`, Apache-2.0.
- Source format: UTF-8 `.rules` text. The first non-empty line is a comma-delimited header. Third field is the default routing action: `0=proxy`, `1=direct`; remaining lines contain IPv4/IPv6 CIDRs.
- Converter: `src/shared/sstap-rule-parser.cjs`.
- Download, ZIP verification, conversion, versioned storage and active pointer: `src/shared/sstap-rule-library.cjs`.
- Conversion format: sing-box local source rule set, `{ "version": 1, "rules": [{ "ip_cidr": [...] }] }`.
- Runtime storage: `%APPDATA%\SSTap Next\rules\sstap-rule-library\versions\<commit-sha>\`; `current.json` points to the active revision.
- UI: `apps/desktop/src/renderer/src/main.tsx` / `style.css`; bridge: `apps/desktop/src/preload/index.cjs`; IPC and encrypted settings: `apps/desktop/src/main/index.cjs`.
- TUN integration: `src/shared/tun-controller.cjs` loads selected local rules at session creation. Route order is DNS hijack/sniff → private/LAN direct → user-selected SSTap game rules → automatic `BypassCNandLan.rules` in bypass-cn mode → MetaCubeX GeoSite/GeoIP fallback → final proxy. The automatic broad CN table must remain after selected game rules so an overlapping CIDR cannot defeat an explicit game Proxy rule.
- China bypass retains existing remote MetaCubeX `geosite-cn` and `geoip-cn`; if a rule library is installed, legacy `BypassCNandLan.rules` is auto-added after explicitly selected game rules when mode is `bypass-cn`.
- Selected rule IDs are persisted in encrypted app settings. During an update, IDs no longer present upstream are pruned.
- Rule-library update, routing-setting changes and TUN startup use a fail-closed mutual-exclusion boundary. The controller lock covers in-flight recovery/start/stop promises, retained sessions and requested/awaiting_uac/starting/running/stopping/cleanup_error statuses. While an update is in progress, TUN connect is rejected; while TUN is active or cleanup is unresolved, rule updates and routing-setting changes are rejected. The renderer disables the corresponding controls, but Electron main/controller checks are authoritative. A failed download/conversion does not replace the current pointer; prior revisions are retained.

## Key implementation files

- `src/shared/sstap-rule-parser.cjs`: original SSTap header + CIDR parsing and conversion.
- `src/shared/sstap-rule-library.cjs`: ZIP parser (store/deflate), CRC validation, updater, atomic version pointer and selected local source rules.
- `src/shared/zip-test-fixture.mjs`, `zip-reader.test.mjs`, `sstap-rule-parser.test.mjs`, `sstap-rule-library.test.mjs`: converter/updater tests.
- `src/shared/tun-config.cjs`: local rule-set descriptors and route precedence.
- `src/shared/tun-controller.cjs`: load active local rules before writing each TUN session config.
- `docs/SSTAP-RULE-CONVERSION.md`: format mapping, converter, updater and fallback behavior.
- `docs/third-party/FQrabbit-SSTap-Rule-LICENSE.txt`: upstream license copy.

## Build and validation

On Windows 10/11 x64 with Node 22+ and .NET 10 SDK:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

The Windows build script runs Node tests, 54 protocol/mode/DNS sing-box combinations plus one actual local SSTap source-rule-set configuration (Proxy + Direct), .NET Agent publish, TypeScript/Vite build, NSIS packaging and doctor. Confirm the test counts and installer SHA-256 from the actual workflow; do not claim local Windows TUN acceptance from CI alone.

## Safety constraints

- Do not delete Wintun/network adapters, drivers, routes or reset DNS to bypass cleanup errors.
- Keep all current fail-closed cleanup protections.
- Never publish user node URI, password, subscription URL, encrypted state, session files or runtime configs.
- Keep sing-box version pinned unless separately audited.
- Do not perform rule-library updates or change routing settings while TUN is recovering/starting/running/stopping or in cleanup_error; do not start TUN while a rule-library update is running.
- The app must retain the last valid rule library when upstream download, extraction, parse or validation fails.


---

# 新 GPT 接手规则（2026-11-07 补充，优先于本文件较早的工作流描述）

**第一入口：** 仓库根目录的 [START HERE NEXT GPT.md](START%20HERE%20NEXT%20GPT.md)。新对话必须先读该文件，再读本 HANDOVER、PROJECT-OVERVIEW-CN.md 和 PROJECT-DEVELOPMENT-LOG-CN.md。

## 用户确认的开发方式

- 这是个人项目，日常只在 main 直接开发；不要再建立 feature 分支、长期分支或 PR。PR #1 已合并，仅是历史记录。
- **每一项开发都必须文档优先：先更新文档，写清问题、目标、现状、设计、影响文件、安全约束、验收和测试方案，然后才改代码。** 功能、重构和 bug 修复均适用。
- 开发中设计或范围变化，要同步更新文档；上下文即将到上限，必须先更新 START HERE NEXT GPT.md、HANDOVER.md 和 PROJECT-DEVELOPMENT-LOG-CN.md，再结束本轮。
- 正式交付递增 SemVer，统一同步所有版本字段，更新 CHANGELOG 和 docs/RELEASE-X.Y.Z.md。直接提交 main，由 GitHub Actions 构建并发布；确认 EXE、blockmap 和 SHA-256 三个资产存在后才算完成。
- 故障回滚优先使用 GitHub Revert；不重写历史、不强推。

## 当前发布和代码状态

- 当前正式版本：0.3.12；Tag：v0.3.12。
- Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.12
- 0.3.12 规则库代码合并提交：8f4be60d480e798bf3d17291230454df70674c86。
- EXE：SSTap.Next-0.3.12-x64.exe；SHA-256：42c700f4234b50e1ee31392d84d405954c3ad773aa8778201914900a792f3cdd。
- Node 测试 86/86、package-lock 704/704、sing-box 55/55、Windows x64 Agent、TypeScript/Vite、NSIS、安装包 SHA 验证均有对应 PR 最新 HEAD / main 发布流水线成功证据。具体 run ID、URL 和验证边界以 START HERE NEXT GPT.md 为准。
- **未完成的是用户 Windows 10/11 实机验收**，不是 Release 构建。真实规则库下载、Proxy/Direct 实际路由、失败回滚、TUN 生命周期互斥、真实节点/UDP/QUIC、10 轮 Wintun 清理均须按 docs/WINDOWS-ACCEPTANCE.md 记录，不能把 CI 通过冒充实机通过。

## 当前代码关键约束

- 原版 SSTap 规则第三个头字段：0=proxy、1=direct；禁止按文件名猜路由动作。
- route order：private/LAN 安全直连 → 用户显式选中的 SSTap 规则 → bypass-cn 自动 BypassCNandLan.rules → GeoSite/GeoIP fallback。
- 规则更新必须下载、ZIP 校验、解析、转换全部成功后，原子切换 current pointer；失败保留旧版本。
- 规则更新与 TUN recovery/start/stop/active/cleanup_error 互斥；更新期间禁止启动 TUN；Electron 主进程/controller 是安全边界，不能只依赖 Renderer 按钮禁用。
- cleanup_error 必须 fail-closed。不得删除未知网络适配器、Wintun 驱动、路由或 DNS，不得为了重连而重置网络。

新对话遇到任何旧条目与当前规则冲突时，以 START HERE NEXT GPT.md 最后更新的当前状态、GitHub main 最新内容和用户本轮明确指令为准。历史开发日志保留当时记录，不要把历史操作指令重新当作当前命令。


---

# 0.3.13 批量节点检测与测速交接（2026-11-07，需求/设计阶段）

用户希望节点管理页直接显示每个节点的 PING、TCPING、真实代理延迟和下载速度；支持一键全部检测/只测选中节点；同时测试节点数量可选 1/2/4/8/16/32；使用约 10 MB 测速文件；支持进度和取消。

**设计文档：** `docs/CONCURRENT-NODE-TESTING.md`。状态是“需求已确认，设计已记录，尚未实现”；当前程序仍是 0.3.12，不得声称 0.3.13 功能已经写入或发布。

## 当前测速为何有启动延迟

- 当前 Renderer 只传单个 selectedNodeId。
- Electron speed-test IPC 在没有同节点活动本地连接时调用单例 CoreController.connect(node)，生成临时配置，执行 sing-box check，spawn 核心，等待本地 SOCKS5 端口就绪，再通过 SOCKS5 下载测速，结束时 disconnect。
- sing-box inbound 是 mixed、loopback 127.0.0.1，并显式 set_system_proxy:false；没有切换 Windows 系统代理设置。用户所说“先生成系统代理”实际是本地测速核心/SOCKS5 会话的启动过程。
- 当前 speedTestThreads=1/2/4/8 是**单节点下载 Range 分段线程数**，不是并发节点数。
- 当前测速会复用同一个已连接节点；如果当前已连接另一节点，会拒绝测速。批测不可用反复切换主 CoreController 的方式实现。

## v2rayN 参考结论

当前 v2rayN SpeedtestService.cs 的 Tcping 是直接对目标 address/port 执行并发 TCP connect；批量 MixedTest 使用 MixedConcurrencyCount 控制并发节点，每个节点独立测试核心会话和本地 SOCKS，做真实代理延迟/下载后关闭。其实现可作架构参考，但不可照搬为不受限的 32 进程风暴。

## 下一版设计红线

- 同时测速节点数 1/2/4/8/16/32，与单节点下载 Range 线程数必须分别命名、分别限流。
- PING 是 ICMP，TCPING 是原始 TCP connect，真实代理延迟是通过本节点协议访问 HTTP；三个指标不能相互替代。
- Hysteria2 使用 UDP/QUIC，TCPING 必须显示“不适用”。
- 批测结果直接在节点管理列表显示，逐节点更新，保存最近值/时间，失败原因分开记录。
- 新建专用 batch test runner/有界 worker pool，不得通过主 CoreController 来回切换节点；不自动断开/切换用户活动连接。
- 测试核心只能监听 loopback 且 set_system_proxy:false；不得改 Windows Internet Settings、注册表系统代理或 PAC。
- 批量任务可取消；取消后确认本批启动的进程退出、临时文件清理，不误杀主核心或 TUN Agent。
- 保留 TUN active/transitioning/cleanup_error 安全边界；任何优化不能放宽 TUN 与网络清理保护。
- 用户 10 MB 文件可按设置使用；16/32 并发会共享 500 Mbps 出口，需要在结果中明确这是并发带宽分摊值。

正式实现升为 0.3.13；先更新专题设计和本文件/START HERE，再写代码。当前尚未修改任何运行时测速代码。


## 0.3.13 实施路线补充（2026-11-07）

- 批量测速运行时采用每批一个临时 sing-box 进程，不是每个节点一个进程。每个节点拥有唯一 loopback inbound + outbound tag，由 route rule 按 inbound tag 锁定 outbound；每个 inbound set_system_proxy:false。
- 单批最多 32 节点；大于 32 的节点分批运行。批测节点并发 batchTestConcurrency 默认 4，可选 1/2/4/8/16/32。
- 单节点 Range 分段 speedTestThreads 扩展 1/2/4/8/16/32。全局 Range worker budget=64，实际每节点 Range worker 数按并发节点数动态上限；不能 32x32。
- 独立 runner 实施路径 src/shared/batch-node-test.cjs；PING=ping.exe 3 次；TCPING=TCP socket connect；Hysteria2 N/A。
- 结果持久化为 nodeTestResults，按 nodeId 更新，节点删除/订阅替换时必须防止孤儿记录。
- Windows 核心配置校验新增多节点批测配置，sing-box 检查从 55 增至 56。
- 正式代码版本为 0.3.13；本补充只是实现前设计定稿，尚未改运行时代码。


# 0.3.13 批量节点检测实施交接（2026-11-07）

## 实际实现范围

- 专题设计：docs/CONCURRENT-NODE-TESTING.md；先文档后代码的设计记录保留。
- runner：src/shared/batch-node-test.cjs。每批不超过 32 节点，由一个 sing-box 进程承载多个 loopback-only mixed inbound 和 node-specific outbound；路由按 inbound tag 锁定 outbound，final=block。
- ICMP：Windows ping.exe 三次，解析英语/中文 ping RTT 和丢包；TCPING：三次 TCP socket connect；Hysteria2 TCPING 显示不适用。
- 代理延迟与下载：通过每节点 SOCKS inbound，复用 requestLatency/downloadSpeedTest/备用源；下载范围由用户 speedTestBytes 和 speedTestThreads 设置决定。
- 并发：batchTestConcurrency 1/2/4/8/16/32（默认 4）；每节点 Range 线程 1/2/4/8/16/32；全局 Range worker 预算 64，并支持 3、5 等非 2 的幂次节点数。
- UI：节点管理页全量/勾选、全选、并发/Range 线程参数、保存参数、进度、取消；每节点显示 PING/TCPING/代理延迟/下载/最近检测。
- 数据：nodeTestResults 按 nodeId 保存进加密用户状态，最多 512 条，节点删除后持久化时裁剪孤儿记录。
- 安全：不走主 CoreController，不切换/断开现用连接，不修改 Windows 系统代理；TUN unsafe 状态由主进程 IPC 拒绝。取消时等待 ping child close、worker settle、批测 sing-box 退出后清理配置；无法确认退出则保留配置供诊断。
- 配置验证：scripts/validate-singbox-configs.mjs 新增两节点批测配置实际 sing-box check；目标总计 56 项。

## 发布状态

- 最新正式 Release 仍为 v0.3.12；开发中的 0.3.13 尚未发布。
- 0.3.13 需要确认本次最新 SHA 对应的 Node CI、Windows workflow 和 56 项 sing-box check，之后正式升版、发布。
- 用户 Windows 实机仍需验收 1/2/4/8/16/32 并发 CPU、内存、共享带宽、系统代理不变、用户连接未中断、取消后的进程/端口/临时文件清理。
- 下一对话首先刷新 GitHub main SHA、package version、最新 Actions run/job/step 和 Release 资产；不复用历史 workflow 成功状态。


## 0.3.13 正式版本化与 Release 交接（2026-11-07）

- package.json / package-lock.json 根版本同步为 0.3.13。
- .NET Agent csproj Version 与 Program banner 同步为 0.3.13。
- scripts/Build-Windows.ps1 显示 56 组 sing-box 配置检查和 0.3.13 构建完成信息。
- scripts/doctor.mjs 项目版本检查不再硬编码过时的 0.3.7，而是检查 package.json 与 package-lock 根版本一致性。
- docs/RELEASE-0.3.13.md 已存在；README、CHANGELOG、PROJECT-OVERVIEW 已更新为 0.3.13 功能说明。
- 0.3.12 是上一正式 Release。0.3.13 要以最新 package bump commit 对应 CI/Windows workflow 成功，以及 Release API 真实列出 installer/blockmap/SHA-256 三项资产为完成判据。
- Windows 10/11 用户实机 1/2/4/8/16/32 压力、代理不变、活动连接隔离和取消清理仍未执行。



## 0.3.13 Release — 已正式发布并核验（2026-11-07）

- Tag / Release：v0.3.13 — https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.13
- Release target commit：`9d733967fb8c1280da6a1603b7ab9f733da6eccf`
- 当前 main 文档接力 HEAD（更新前）：`5344ca830e2625f4575467e6ed234c58f16006ad`；与 Release target 的差异为 Release 后续文档同步，不改变 0.3.13 运行时代码。
- Node CI：run `42352257931`（版本提交 SHA）和 run `42352323487`（当前文档 HEAD SHA）均 success；日志：`npm test 97/97 PASS`、`npm run verify:lock` 中 704 个依赖引用全部兼容。
- Windows Release workflow：run `42352257898`，job `128342706123`，success；npm ci、release version 校验、package-lock 校验、Build-Windows、安装包验证、Release 发布及 artifact 上传均 success。
- sing-box：当前 runtime 核心 1.14.4，真实配置矩阵 **56/56 PASS**（54 基础组合 + SSTap 本地规则集 + 多节点批测配置）。
- 安装程序：`SSTap.Next-0.3.13-x64.exe`，174,891,825 bytes；SHA-256：`113105a99e5201f6f7a3013ee82ce8583bcc6f69f88fea9d969e35b52b15abcd`。
- Blockmap：`SSTap.Next-0.3.13-x64.exe.blockmap`，182,868 bytes。
- SHA-256 sidecar：`SSTap.Next-0.3.13-x64.exe.sha256`，93 bytes。
- Workflow artifact：`SSTapNext-main-Windows-x64`，ID `13566081600`，175,084,704 bytes，尚未过期。
- Release API 已核实三个资产均实际存在；安装程序 SHA-256 与 Windows 构建日志和 Release asset digest 一致。
- **NOT RUN：** 用户 Windows 10/11 实机的 1/2/4/8/16/32 并发 CPU/内存/共享带宽压力、Windows 系统代理前后状态比对、正在使用的连接不被切换/中断、取消后进程/端口/临时配置完全清理，以及真实节点公网出口/协议连通性。不可用 CI 替代这些实测。
