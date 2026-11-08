# START HERE NEXT GPT — SSTapNext 接手入口

> **给下一位 GPT：先读本文件，再开始任何工作。不要从旧对话猜进度，不要从旧 ZIP 拼源码。**
>
> 仓库：https://github.com/xiaobei206/SSTapNext  
> 唯一开发线：**main**  
 > 当前正式发布版本：**0.3.16**（GitHub Release）
> main 当前开发版本：**0.3.17（开发中，未发布）**  
上一正式 Release：**0.3.16**  
> 本文件是新对话的第一入口；如果本文件与 GitHub 实际状态不一致，以实时仓库、Actions 和 Release 为准，并先修正文档。

## 2026-11-08 当前 P0：TUN 孤儿会话恢复

- 用户在 v0.3.16 启动时遇到遗留会话 30 秒超时。实机证据：status 仍为 running、corePid 4968，但 Agent/sing-box 进程均不存在；Agent 双重枚举报告所有 SSTap Next `sing-tun Tunnel` 相关对象均 NotPresent、无 IP、无检查错误。
- 与本故障无关的旧版 `SSTAP 1 / TAP-Windows Adapter V9` 必须完全排除，不可修改或删除。
- 设计先行文档：`docs/TUN-ORPHAN-RECOVERY-0.3.17.md`。目标正式修复版本 0.3.17：仅在双重核验确认旧核心 PID 不存在且所有 SSTap Next TUN 接口均不活动/无地址后，归档孤儿状态并安全解除锁；任何歧义仍 fail-closed。桌面端停止等待上限从 30 秒调整为至少 45 秒，以覆盖 Agent 18+18 秒预算。
- 当前状态：设计文档已提交；代码修复尚未开始。继续先同步交接/开发日志，再实现与测试。

---

## 0. 接手时必须遵守的工作方式

这是用户自己的个人项目。用户明确要求简单直接：

1. **只在 main 开发。** 日常开发禁止新建 feature 分支、长期分支和 PR。不要自行引入 Git Flow、review gate 或复杂分支策略。PR #1 是历史迁移记录，不是今后模板。旧分支 feature/sstap-rule-library-0312 即使仍显示在 GitHub，也不要继续使用。
2. **先写文档，再写代码。** 这是强制流程，不是可选建议。每一项新功能、重构、缺陷修复，在改任何代码前，先更新相关设计/交接文档，明确目标、现状、涉及模块、行为约束、验收标准、测试方案和风险；同时更新本文件的“当前状态/下一步”或确认它仍准确。文档没有写清楚，不开始代码修改。
3. **开发过程中持续维护交接文档。** 一旦实现范围、设计决定、文件影响或未完成事项发生变化，立即同步文档。不得等到上下文快用完才凭记忆补文档。
4. **每轮工作结束时写明证据。** 记录真实执行的测试命令、通过/失败数量、未执行项目、Windows 实机结果、GitHub commit SHA、Actions run URL、Release URL。未执行的测试必须写 NOT RUN，不能写成通过。
5. **上下文即将到上限时先停代码、先交接。** 更新本文件、HANDOVER.md 和 PROJECT-DEVELOPMENT-LOG-CN.md：写清当前 commit、改了哪些文件、做到哪一步、哪些测试通过/失败/未运行、是否有未提交改动、下一步唯一明确动作。让下一对话只读仓库即可接上，不要求用户重新讲历史。
6. **版本和发布。** 用户可见的正式版本迭代必须递增 SemVer，统一同步所有版本来源（至少根 package.json、package-lock.json，以及项目中显示/报告/Agent/构建涉及的版本字段），补齐 docs/RELEASE-X.Y.Z.md，再提交 main。由 GitHub Actions 构建并发布 vX.Y.Z，确认 EXE、blockmap、SHA-256 三个资产真实存在后才算发布完成。不要用 FIX、FIX1、FIX2 或不递增版本的正式补丁。
7. **提交与回滚。** 在 main 做小而聚焦、可追溯的提交。用户接受 GitHub Revert 回滚；不重写历史、不强推、不为个人项目制造分支流程。
8. **沟通。** 用中文，先做事再报告事实。避免重复询问仓库里已有的信息；不要只写计划却不实际检查/开发；不要把 CI 构建通过说成真实网络/TUN 已验收。

### 每一轮开发的固定顺序

- A. 刷新 GitHub main 最新 commit、文件树、package 版本、tag/release、最近 CI 和 Windows workflow 状态。
- B. 阅读本文件、HANDOVER.md、PROJECT-OVERVIEW-CN.md、开发日志，以及本任务涉及的专题文档。
- C. **先提交/更新文档**：问题定义、目标、方案、改动范围、验收和回滚办法。
- D. 再改代码；每一阶段做针对性测试。
- E. 完成后更新开发日志、交接、README/CHANGELOG/版本发布说明，明确真实验证证据和遗留项。
- F. 直接提交 main；检查对应 commit 的 Actions。发布后检查 Release 和三个资产。
- G. 如果发现上下文不足以安全完成，按第 5 条先交接，不要留下“下一个 GPT 自己猜”。

---

## 1. 当前可信基线（Release 已核实至 2026-11-07；main 正在开发 0.3.17）

### 仓库与版本

- GitHub：xiaobei206/SSTapNext
- 唯一开发入口：main；不新建 feature 分支或 PR。
- 当前正式 Release：v0.3.16（2026-11-07），https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.16
- 当前公开 Release：v0.3.16；main package / Agent version 已递增至 0.3.17（开发中，未发布）；上一正式 Release：v0.3.16。
- v0.3.16 Release target commit：`6245eab7e953ff13c0f765691a8ad1692e15f14e`；本次收尾开始时 main HEAD：`f3e27bfba1a3480317fa7555c9296dd38fc5d2fa`（比发布目标只多一个文档提交，运行时代码一致）。
- 为消除首次 CI 偶发状态 JSON 解析失败，追加了仅测试夹具提交 `6ba1c2e6dacdfa59c62c109190086597578bf9a2`；该提交只改 `src/shared/tun-controller.test.mjs`，Node CI run [42369688144](https://github.com/xiaobei206/SSTapNext/actions/runs/42369688144) **107/107 PASS、0 fail，lock 704/704 PASS**。运行时代码、版本号和 v0.3.16 发布资产未改动。
- 旧分支 `feature/sstap-rule-library-0312` 不再使用；PR #1 仅是历史迁移记录。

### 最新自动化与发布证据（0.3.16，已核验至 2026-11-07）

- 正式 Release：v0.3.16，https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.16；Release target commit：`6245eab7e953ff13c0f765691a8ad1692e15f14e`。根 `package.json`、`package-lock.json` 和 Agent 版本均为 0.3.16。
- Release Node CI run [42365153162](https://github.com/xiaobei206/SSTapNext/actions/runs/42365153162)：`npm test` **107/107 PASS，0 fail**；`npm run verify:lock` **704/704 PASS**。
- 完整 Windows Release run [42365153123](https://github.com/xiaobei206/SSTapNext/actions/runs/42365153123)，job `128381544820`：成功执行 package-lock 校验、Build-Windows、sing-box **58/58**、.NET 10 Agent、TypeScript/Vite、NSIS、安装包 SHA 校验、Release 发布和 artifact 上传。
- Release 资产已通过 GitHub Release API 核实：EXE 174,898,679 bytes，SHA-256 `68c7094f74ef50c85ca96e9e07110be9397703fbaa915233a4634e5d8292261d`；blockmap 182,455 bytes；SHA-256 sidecar 93 bytes。完整资产和各自摘要见 `docs/RELEASE-0.3.16.md`。
- 本次收尾开始时 main HEAD 为 `f3e27bfba1a3480317fa7555c9296dd38fc5d2fa`，仅比 Release target 多 1 个文档提交，没有运行时代码差异。该 HEAD 的 Node CI run [42365557674](https://github.com/xiaobei206/SSTapNext/actions/runs/42365557674) 也成功，107/107 测试与 704/704 锁文件检查通过。
- 注意：当前 HEAD 的 Windows workflow run [42365557673](https://github.com/xiaobei206/SSTapNext/actions/runs/42365557673) 虽为 success，但因 v0.3.16 Release 已存在，Build/安装包校验/发布步骤被 skip。它不是一次新的完整安装包构建；正式包完整构建证据是 Release target 的 run 42365153123。
- 文档收尾提交 `0b88f3eef4333871006bd4c3eb3bb963f58ccc0d` 的 CI run [42369369282](https://github.com/xiaobei206/SSTapNext/actions/runs/42369369282)：首次 attempt 的 `npm test` 为 106/107，唯一失败是 `isolates DNS cache databases for IPv4-only, IPv4-first dual-stack and IPv6-first dual-stack` 在 `_readAgentStatus()` 解析状态 JSON 时遇到 `Unexpected end of JSON input`；对同一 SHA 重跑失败 job 后 attempt 2 为 **107/107 PASS、0 fail，lock 704/704 PASS**。随后在 test-only commit `6ba1c2e6dacdfa59c62c109190086597578bf9a2` 中，让模拟 Agent 状态写入与真实 `TunRuntime.WriteStatusAsync()` 一致：写入 `.tmp` 后用 `fs.rename()` 原子替换。该提交的 CI run [42369688144](https://github.com/xiaobei206/SSTapNext/actions/runs/42369688144) 首次运行即 **107/107 PASS、lock 704/704 PASS**；只改测试夹具，不修改生产运行时代码。
- 同一提交的 Windows workflow [42369369316](https://github.com/xiaobei206/SSTapNext/actions/runs/42369369316) 为 success，但因为 v0.3.16 Release 已存在，lock/build/installer SHA/publish/upload 步骤均 skipped；不算新安装包构建。
- 新提交之后必须再核对对应 SHA 的 Actions；不要将文档-only 提交的绿色工作流说成重建了安装包。

### 重要验证边界

**CI 与安装包构建通过，不代表用户 Windows 10/11 实机的代理、系统路由/DNS、UDP/QUIC 或 TUN 清理已经验收。**

当前仍须在用户机器上确认（均为 **NOT RUN / 未提供实测记录**）：

- 安装 v0.3.16，系统 TUN 在 UAC 后能启动，不再出现 Agent 拒绝 Clash API 的错误；Global / bypass-cn / rule 模式均可运行。
- 本地代理和 TUN 的实时上/下行速率、分开累计、断开 final flush、重连计数重置、跨重启的节点累计；TUN 统计明确包含 Direct 流量，且不将 TUN 总量写入某个节点的个人累计。
- 规则库首次下载、Proxy/Direct 路由优先级、失败更新保留 last-known-good、TUN 生命周期与规则更新互斥。
- 批量节点检测 1/2/4/8/16/32 并发、取消后的进程/端口/临时文件清理；不切换活动节点、不修改 Windows 系统代理、不打断已有连接。
- 无路由 TUN smoke test；全部通过后，执行真实 TUN connect → disconnect → reconnect 至少 10 轮，核对核心退出、路由/DNS 恢复和 Wintun 资源判据。
- 真实节点握手、公网出口、浏览器业务、DNS、IPv6（适用时）及 UDP/QUIC；最后检查统计 UI、节点表排序/布局与字号。
- Agent 源码实现了非法 Clash API 形态的拒绝条件，但仓库当前没有独立的 .NET 行为级测试来实际执行所有恶意配置样例；该负向行为测试仍未运行，不要误标为已通过。
- 已处理一次 Node 回归测试夹具的非原子写入问题：`src/shared/tun-controller.test.mjs` 模拟 Agent 现在先写 `.tmp` 并原子替换 `status.json`，与真实 Agent 一致。修复提交 `6ba1c2e6dacdfa59c62c109190086597578bf9a2` 的 CI 107/107 PASS；生产 Agent/TUN 源码未改。真实 Windows TUN 仍待用户验收。

开始真实 TUN 前，按 `docs/WINDOWS-ACCEPTANCE.md` 的 smoke-test 与停止条件执行；遇到 `cleanup_error`、未知网卡归属或路由/DNS 不一致应停止，不手动删除网卡、不重置 Windows 网络。

## 2. 项目是什么、核心结构在哪里

SSTap Next 是 Windows x64 代理客户端：Electron + React/TypeScript UI，Node.js shared 模块，独立 .NET 10 提权 Agent，sing-box 内核与 Wintun TUN。支持本地 loopback 代理、节点与订阅、测速、系统级 TUN、三种分流模式、DNS 地址族策略、sing-box 核心管理，以及 SSTap 经典 .rules 规则库导入和在线更新。

主要目录：

| 路径 | 职责 |
|---|---|
| apps/desktop/src/main/ | Electron 主进程、IPC、生命周期、数据与连接协调 |
| apps/desktop/src/preload/ | 最小化安全桥接，限制 renderer 能力 |
| apps/desktop/src/renderer/src/ | React UI、页面、交互、样式 |
| src/shared/ | 规则解析、节点解析、sing-box 配置、TUN config/controller、更新器 |
| src/agent/SstapNext.Agent/ | .NET 10 Windows 提权 Agent、进程和 TUN 资源清理 |
| runtime/sing-box/ | Windows sing-box 核心与随包依赖 |
| scripts/ | Windows 构建、配置检查、锁文件检查、smoke test、doctor |
| docs/ | 专题设计、安全约束、测试计划、Windows 验收、版本说明 |

重点代码：

- 原版 .rules 解析/转换：src/shared/sstap-rule-parser.cjs
- 规则库下载、ZIP 校验、版本化储存与 current 指针：src/shared/sstap-rule-library.cjs
- TUN rule-set 顺序/配置：src/shared/tun-config.cjs
- TUN 生命周期和安全锁：src/shared/tun-controller.cjs
- Electron 主进程 IPC 和规则库更新互斥：apps/desktop/src/main/index.cjs
- Renderer UI：apps/desktop/src/renderer/src/main.tsx、style.css
- 构建/配置检查：scripts/Build-Windows.ps1、scripts/validate-singbox-configs.mjs

### 不能破坏的网络和安全不变量

1. 本地 mixed SOCKS/HTTP 代理只监听 loopback，不暴露 LAN、不自动修改 Windows 系统代理。
2. Renderer 不直接获取 Node/Electron 权限；IPC 要保留可信来源校验与最小暴露。
3. TUN 生命周期由独立 .NET Agent 经 UAC 管理；配置/会话/路径校验不能因方便而放松。
4. cleanup_error 是 fail-closed 安全锁，不得为了“重新连接”而无条件清除。
5. 不删除、不禁用不归本次会话的 Wintun/网络适配器；不猜测执行 route delete、Winsock reset、清 DNS 或关闭防火墙。
6. 只有确认 sing-box 进程退出且本次会话的 TUN 资源安全释放，才能解除对应清理锁。Windows 保留 Down 且无 TUN 地址的 Wintun 对象不应仅因对象仍存在而误报；Up 或仍持有 172.19.0.1 必须阻止再次接管。
7. 规则库更新、分流/DNS 设置修改与 TUN 生命周期互斥：TUN recovery/start/stop/active/cleanup_error 时禁止规则库变更；规则库更新期间禁止 TUN 启动。UI 禁用不是唯一安全边界，主进程/controller 必须校验。
8. 规则更新要先完整下载、校验、解析和转换，最后原子切换 current pointer；失败不得损坏/替换上一有效版本。
9. 私有/LAN 安全直连在前；用户显式选择的 SSTap 游戏规则在宽泛的自动 BypassCNandLan.rules 之前；自动大陆规则再早于 GeoSite/GeoIP fallback。不得反转 Proxy/Direct：原规则头第三字段 0=proxy、1=direct。
10. 不记录/提交节点 URI、密码、订阅 URL、加密用户状态、运行时会话文件或真实代理配置。

---

## 3. 构建和常用验证

目标环境：Windows 10/11 x64、Node.js 22+、.NET 10 SDK。用户 PowerShell 环境中调用 npm 请使用 npm.cmd，避免调用受执行策略影响的 npm.ps1。

Windows 全量构建（项目根目录）：

~~~powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
~~~

常用 Node 验证：

~~~powershell
npm.cmd ci --no-audit --no-fund
npm.cmd test
npm.cmd run verify:lock
npm.cmd run doctor
npm.cmd run validate:core
~~~

说明：

- npm test 当前历史基线为 86/86；测试数量会随开发变化，以本次真实输出为准。
- verify:lock 当前覆盖 704 项依赖引用；锁文件变化必须解释原因，禁止为了通过 CI 而放松范围校验。
- validate:core 需使用项目实际 sing-box 核心。
- Windows workflow 使用 Node 22 + .NET 10，在 Windows runner 执行完整构建；本地仅执行 Node tests 不能代替该流水线。
- Build-Windows.ps1 会完成 Node、核心配置检查、Agent、TS/Vite、NSIS 等阶段。检查脚本输出和退出码，不要只看最后几行。

---

## 4. 文件阅读顺序（新对话必须执行）

1. **本文件：START HERE NEXT GPT.md** —— 当前状态、工作纪律和下一步。
2. HANDOVER.md —— 当前架构、重点代码、安全边界。
3. PROJECT-OVERVIEW-CN.md —— 全局模块说明。
4. PROJECT-DEVELOPMENT-LOG-CN.md —— 唯一持续累积的开发历史和验证记录。历史记录中可能保留当时正确、后来已过时的指令；按时间最新的“当前状态”覆盖旧条目。
5. docs/TEST-PLAN.md —— 自动化范围和 CI/实机验证边界。
6. docs/WINDOWS-ACCEPTANCE.md —— 真实 Windows 实机验收清单。
7. docs/SSTAP-RULE-CONVERSION.md —— .rules 原格式、转换、规则优先级。
8. docs/GITHUB-RELEASES.md 与 docs/RELEASE-0.3.16.md —— 当前发布链路与当前版本；需要研究原版规则库时再查历史 docs/RELEASE-0.3.12.md。
9. 依任务读取 docs/DECISIONS.md、docs/CORE-UPGRADE.md 等专题文档。
10. 最后读相关代码和测试，不要先写代码再倒推设计。

GitHub 最新状态每次都应现查：

- 仓库 main 最新 commit / commit message / 文件状态；
- 根 package.json 版本、package-lock.json 根版本；
- 当前 release tag 与三个资产；
- 对应 main commit 的 Node CI、Windows workflow 及各 job 结果；
- 是否存在未完成的 run、失败 run 或取消 run。被取消/旧 SHA 的 run 不算当前 HEAD 验证成功。

---

## 5. 当前工作队列（接手后从这里开始）

### P0 — 完成 v0.3.16 Windows 实机验收（当前唯一首要动作）

正式 Release 与 CI/Windows 构建已经完成。当前不要进行无关重构或覆盖 v0.3.16 资产。请按 `docs/WINDOWS-ACCEPTANCE.md` 执行并逐项记录：

1. 安装官方 v0.3.16，核对版本显示和安装包；资产与摘要见 `docs/RELEASE-0.3.16.md`。
2. 先验证普通本地代理、节点选择、订阅、PING/TCPING/代理延迟/下载测速和批量检测；确认活动节点/系统代理未被批测切换。
3. 验证 SSTap 规则库下载与更新、Proxy/Direct 动作、规则优先级；对更新失败/损坏 ZIP 确认旧版本和已选规则保持可用。
4. 运行无路由 TUN smoke test。只有 smoke test、普通代理和前后路由/DNS快照均正常后，才进入真实 TUN。
5. 启动系统接管，确认 Agent 不再报 Clash API 白名单错误；分别验证 Global、bypass-cn、rule 模式，检查实际出口、DNS、浏览器业务和 UDP/QUIC。
6. 验证上传/下载实时速率及分项累计、本地代理节点历史累计、TUN 含直连的系统会话累计、断开 final flush、重连重置和应用重启后持久化。
7. 至少执行 10 轮真实 TUN connect → disconnect → reconnect；检查核心退出、物理默认路由/DNS 恢复以及 Up/仍带 `172.19.0.1` 时的 fail-closed 保护。Down 且无 TUN 地址的持久化接口对象不能仅因仍存在就被误报为活动残留。
8. 测试 `cleanup_error`、TUN 转换中和规则更新中的并发互斥；发现错误时停止，不以删除网卡、route delete、Winsock reset 或清 DNS 绕过保护。
9. 测试完成后，把版本、模式、可复现步骤、脱敏日志、结果与日期填入验收文档。节点 URI、密码、订阅 URL、Bearer secret 和 `state.enc.json` 不得公开。

### P1 — 后续补齐 Agent 白名单负向行为测试

- 已发布代码继续只接受 `127.0.0.1:<合法端口>`、64 位 hex secret 和恰好 `external_controller` / `secret` 两字段；根级 `endpoints` 仍禁止。
- 当前 Windows Release 编译 Agent 并验证了生成配置矩阵，但仓库没有独立的 .NET 行为级测试来实际执行全部恶意配置形态（LAN / wildcard / IPv6、非法端口、重复/额外字段等）。这项仍为 **NOT RUN**；后续应先设计可靠、可自动化的 Agent 验证方式，再按项目版本纪律实现。

### 已交付 — 0.3.13：批量节点检测与测速（Release 已发布；用户实机验收待办）

用户确认的需求：
- 节点管理列表直接显示 PING、TCPING、真实代理延迟、下载速度和最近检测时间。
- 一键检测全部节点，或仅检测勾选节点；逐节点回填；支持取消。
- 同时测速节点数 1 / 2 / 4 / 8 / 16 / 32。
- 500 Mbps 宽带、常用 10 MB 测速文件；测试大小沿用“节点测速”页保存的 speedTestBytes 设置。
- 测速不得改 Windows 系统代理，不得自动切换/断开用户当前节点；TUN 不安全时拒绝批测。

当前实现：
- 新模块 src/shared/batch-node-test.cjs；每批最多 32 个节点只启动一个临时 sing-box 进程，多个 loopback inbound 分别绑定对应 node outbound，final=block。
- ICMP PING 通过 Windows ping.exe（三次，识别英文/中文输出）；TCPING 用 TCP socket；Hysteria2 的 TCPING=N/A。
- 每节点独立 SOCKS inbound 做真实代理 HTTP 延迟和 Range 下载；复用现有测速源回退。
- 新增 batchTestConcurrency（默认 4，1/2/4/8/16/32）；speedTestThreads 扩展为 1/2/4/8/16/32。Range 总 worker 预算不超过 64；非 2 的幂次节点数会向下选择合适的线程档位。
- 新 IPC start/cancel/progress；逐节点结果加密持久化在 nodeTestResults（上限 512，保存时清理已删除节点）；节点页显示结果、全选/选中、进度与取消。
- 批测不调用主 CoreController，不修改系统代理；TUN active/transition/cleanup_error 等状态由主进程阻止启动。

重要文件：
- docs/CONCURRENT-NODE-TESTING.md：当前实现架构、限制、实机验收清单。
- src/shared/batch-node-test.cjs / batch-node-test.test.mjs：运行器与测试。
- src/shared/singbox-config.cjs：多 inbound/outbound 测试配置。
- apps/desktop/src/main/index.cjs、preload/index.cjs：IPC/持久化/生命周期。
- apps/desktop/src/renderer/src/main.tsx、global.d.ts、style.css：节点列表 UI。
- scripts/validate-singbox-configs.mjs：新增多节点真实核心配置校验；目标共 56 项（54 基础 + SSTap 规则 + batch config）。

**v0.3.13 已正式发布**，Release 与三个资产见 `docs/RELEASE-0.3.13.md`。Node CI 97/97、lock 704/704、Windows 构建及 sing-box 56/56 均已通过。剩余用户 Windows 实机压力和安全验收必须单独执行，不可将 CI 结果当作通过。用户 Windows 10/11 实机的 1/2/4/8/16/32 并发压力/系统代理不变/活动连接隔离/取消清理仍未验收。

### 已完成 — 0.3.14 修复批量 PING 全部误报超时（Release 已发布）

用户实测：0.3.13 节点列表 36 个节点 PING 全部显示超时；同机 PowerShell 对 `65.49.237.84` 执行 `ping -n 3 -w 1000 65.49.237.84`，三次回复 45ms、43ms、43ms，0% 丢包，平均 43ms。确认是客户端误报，不是目标统一禁 ICMP。

根因：旧解析器依赖完整 `time` / `时间` 前缀；Windows ping.exe 的 OEM 中文输出按 UTF-8 解码后前缀可能乱码，导致有效 ASCII RTT 未识别。

修复：0.3.14 改为按 `[=<]数字ms` 解析，不依赖本地化前缀；新增真实替换字符乱码与 `<1ms` 回归用例。不改变 TCPING、代理延迟、下载测速、系统代理或 TUN 安全行为。

验证：Node CI 98/98、lock 704/704、sing-box 56/56、Windows 完整构建成功；v0.3.14 已发布。**剩余唯一直接验收动作：** 用户安装 0.3.14 后重测 `65.49.237.84`，确认节点列表显示约 43ms。

### P2 — 根据实测结果修复

一旦发现问题：

1. 先在本文件及专题文档写明复现条件、预期/实际结果、风险、修复方案和回归测试；
2. 确认是否属于代码缺陷，避免把线路/节点/运营商限制误判成客户端 bug；
3. 直接在 main 实施最小可靠修复；
4. 正式交付递增版本，同步版本字段和 docs/RELEASE-X.Y.Z.md；
5. 执行针对性回归、全量 CI/Windows build，再发布；
6. 若修复引入严重回归，用 GitHub Revert 回滚错误提交，保留证据，不重写历史。

### P2 — 做新功能前

先确认用户当前最重要的具体目标。不要自作主张扩展范围、重写架构或升级 sing-box/npm 依赖。升级核心或依赖属于独立审计任务，需要先说明兼容性、回滚和验证方案并写文档。

---

## 6. 发布和回滚约定

正式版本流程：

1. 先写文档：设计/行为、风险、测试、验收、回滚和 release notes。
2. 升级统一版本号；更新 CHANGELOG 和 docs/RELEASE-X.Y.Z.md。
3. 运行本地检查与构建；直接提交 main。
4. 对照该 main commit 检查 Node CI 与 Windows workflow。没有成功证据不称“已验证”。
5. 确认 GitHub vX.Y.Z Release 和 EXE + blockmap + SHA-256 资产全部实际存在。
6. 在 PROJECT-DEVELOPMENT-LOG-CN.md 追加证据和遗留项；更新本文件的当前版本/下一步。

若是已经发布的同版本，不允许覆盖原 Release 的二进制资产。修复正式交付必须递增版本。

---

## 7. 交接记录模板（每轮上下文结束前更新）

每次上下文即将结束，把以下内容填进本文件，并追加到开发日志：

- 日期/时间：
- 当前 main HEAD SHA：
- 当前 package version / latest release：
- 本轮目标：
- 文档先行变更：
- 代码变更文件：
- 已完成事项：
- 未完成事项：
- 本次执行命令：
- 测试结果（逐项数量）：
- NOT RUN 项目及原因：
- Actions run URL、run SHA、结论：
- Release URL / 资产核验：
- 工作区是否干净 / 是否存在未提交改动：
- 风险与安全约束：
- **下一位 GPT 第一件必须执行的具体动作：**

**交接底线：** 下一位 GPT 不应需要询问“项目是什么、在哪个分支、现在什么版本、有哪些规则、上次做到哪一步”。本文件与开发日志必须直接回答这些问题。


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


## 0.3.14 PING 修复交接（2026-11-07，已发布）

### 0.3.14 Release — 已正式发布并核验（2026-11-07）

- Tag / Release：v0.3.14 — https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.14
- Windows Release run：42353296447，job 128345843932，success；构建目标 commit `fab186b48b0597b76afc1a79dc6e7c1dd59dbe6b`。
- 最新 parser/test main commit：`d0fbcd52c87aa94c60aeb054789e5fc786e71868`；Node CI run 42353385323 success，npm test **98/98 PASS**，verify:lock **704/704 PASS**。
- Windows 构建实际通过：sing-box **56/56**、.NET Agent、TypeScript/Vite、NSIS、安装包与 SHA 校验、Release 发布和 artifact 上传。
- EXE：`SSTap.Next-0.3.14-x64.exe`，174,892,333 bytes；SHA-256：`61dc8bed3e08307e2b4d32105c0f5d539207ea10935d0bb552c0eb56b1abb007`。
- Blockmap：`SSTap.Next-0.3.14-x64.exe.blockmap`，182,937 bytes；SHA-256：`91a246dd4120f4c33ce74e1bb4fb81f7205cfc6044d05bd904732a231447cb3d`。
- SHA-256 sidecar：93 bytes；asset digest：`463ce07f29966011507040624528a94c6a9ec56abd08a70afb1570c1bc9b1245`。
- Workflow artifact：`SSTapNext-main-Windows-x64`，ID `13566382935`，175,085,295 bytes。
- Release API 已核实 EXE、blockmap、SHA-256 sidecar 三项真实存在；EXE SHA 与构建日志一致。
- **NOT RUN：** 用户安装 0.3.14 后，在节点列表重新检测 `65.49.237.84`，确认显示约 43ms，并抽查其他可达/不可达节点。CI 不能替代此实机结果。

下一步：安装 0.3.14 后，批量重新检测原目标 65.49.237.84，对照 PowerShell 原生平均 43ms；然后抽查其他节点，确认可达节点正常显示 RTT、真正无 ICMP 回包仍显示超时。


## 0.3.15 功能实现记录（历史阶段；已由 0.3.16 正式发布覆盖）

设计文档：`docs/LIVE-TRAFFIC-AND-UI-READABILITY.md`；先行设计提交：`f592fc721d2b097f35fc44eb5ef5aea8ecfa6cf6`。功能代码已进入 main，正式验证/发布尚未完成。

### 已实现（源码已推 main）
- 新增 `src/shared/singbox-traffic.cjs` 与测试：从 sing-box 1.14.4 Clash API `/connections` 读取 `uploadTotal` / `downloadTotal`，拆分累计和速率；随机端口、随机 Bearer 密钥、loopback-only。
- 本地代理和 TUN controller 已分别接入统计生命周期，stop 时 final poll。
- 主进程加密状态新增 `nodeTrafficStats`，只累计本地代理流量；10 秒批量写盘，断开/退出 flush；旧状态字段缺省迁移为空对象。
- 首页显示下载速度、上传速度、本次下载累计、本次上传累计、时长；TUN 标注“含直连流量”。
- 节点管理增加上传累计、下载累计、总流量，PING/TCPING/代理延迟/下载速度/上下载流量/总量/最近检测均可点击排序，缺失值置底。
- 版本号淡化为普通 14px 辅助文字；`small` 全局明确 14px；节点表格扩大横向滚动范围。
- 当前代码分支版本已提升到 package/lock/Agent 0.3.15；公开 Release 仍为 0.3.14。

### 重要边界与安全
- 本地代理流量按 active nodeId 计入节点历史上/下行；TUN 统计只显示该系统会话总量（包含 direct 流量），不归属到节点。
- API 只监听 127.0.0.1，随机 Bearer secret 仅供主进程内采样器使用。代理临时配置/TUN 会话配置文件含 API 端点和 secret，文件位于受权限保护的运行目录；不写入 state.enc.json、不经 IPC 返回、不写入日志，TUN 清理会删除其会话目录。
- 采样每秒一次；节点累计最多 10 秒批量写入加密状态，并在断开/退出 flush。
- 不升级 sing-box、不修改 Windows 系统代理、不改变 TUN Agent fail-closed 清理逻辑。

### 历史阶段待办（已由后续 v0.3.16 发布证据覆盖）

- 本节保留的是 0.3.15 开发阶段的待办快照，不代表当前 CI / Release 仍未完成。
- 自动化、固定 sing-box 配置矩阵、Agent、TypeScript/Vite、NSIS 与安装包 SHA 已在 v0.3.16 正式发布流程中通过；证据见上方当前验证摘要与 `docs/RELEASE-0.3.16.md`。
- 仍未完成的是用户 Windows 10/11 实机验收，包括本地代理和系统 TUN 的双向统计、断开/重连、持久化、direct 流量归属及 UI 布局；不得把 CI 当作实机结果。
- 下一步以本文件当前 P0 验收队列为准，不再重复执行 0.3.15 的旧发布步骤。

## 0.3.16 TUN Clash API 白名单修复（已发布）

- v0.3.15 用户实测在启动系统接管时报 `InvalidDataException: TUN 配置包含不允许的 endpoint 或外部控制接口。`。根因是 Agent 一律拒绝 `experimental.clash_api`。
- v0.3.16 已修复：根级 endpoints 继续拒绝，只允许 loopback IPv4、合法端口、64 hex secret 和 `external_controller` / `secret` 两个 API 字段。
- Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.16；安装包 SHA-256 `68c7094f74ef50c85ca96e9e07110be9397703fbaa915233a4634e5d8292261d`。
- Node CI 107/107、lock 704/704、sing-box 58/58、Agent、TS/Vite、NSIS、installer SHA 与 Release 上传均通过。Windows 实机 TUN 行为仍 NOT RUN，须用户安装后确认。
