# START HERE NEXT GPT — SSTapNext 接手入口

> **给下一位 GPT：先读本文件，再开始任何工作。不要从旧对话猜进度，不要从旧 ZIP 拼源码。**
>
> 仓库：https://github.com/xiaobei206/SSTapNext  
> 唯一开发线：**main**  
> 当前开发版本：**0.3.13（开发/验收中）**  
最新正式发布版本：**0.3.12**  
> 本文件是新对话的第一入口；如果本文件与 GitHub 实际状态不一致，以实时仓库、Actions 和 Release 为准，并先修正文档。

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

## 1. 当前可信基线（已核实至 2026-11-07）

### 仓库与版本

- GitHub：xiaobei206/SSTapNext
- 当前开发入口：main
- 当前开发 package version：0.3.13
- 最新正式 Tag：v0.3.12
- 正式 Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.12
- 0.3.12 功能代码发布 commit：8f4be60d480e798bf3d17291230454df70674c86
- 0.3.12 已经发布，不是“等待构建”、不是“PR 尚未合并”。PR #1 已 Squash merge，仅属历史迁移记录。
- 旧开发分支 feature/sstap-rule-library-0312 不再使用。不要从该分支继续开发，也不要把 PR 当成默认工作流程。
- 文档提交会让 main 的 HEAD 晚于 Release 的代码目标 commit；这不代表程序版本发生变化。接手时务必动态读取 main 最新 SHA，不要把 Release target commit 当成 main 当前 HEAD。

### 0.3.12 Release 资产（GitHub API 已核实）

| 资产 | 大小 | SHA-256 |
|---|---:|---|
| SSTap.Next-0.3.12-x64.exe | 174,882,504 bytes | 42c700f4234b50e1ee31392d84d405954c3ad773aa8778201914900a792f3cdd |
| SSTap.Next-0.3.12-x64.exe.blockmap | 182,676 bytes | 063d182a887807ba5e44d52af7668bf201728ab565dcb70f300a0270b5725723 |
| SSTap.Next-0.3.12-x64.exe.sha256 | 93 bytes | 015472720e7834b5aa0c4ac45e0d247ee693e459d72f3a46033f37d27cb54f17 |

安装包直链：  
https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.12/SSTap.Next-0.3.12-x64.exe

### 最新已知自动化验证证据

- PR 最新代码 HEAD b22ab5081f52a7fa57ddc8e583197ba634b7e69f：
  - Node tests：**86/86 PASS**
  - package-lock：**704/704 PASS**
  - sing-box：**55/55 PASS**（54 组协议/模式/DNS + 1 组 SSTap local source Proxy/Direct 真实配置检查）
  - Windows x64 Agent、TypeScript/Vite、NSIS 安装包和 SHA-256 构建通过。
  - Node CI：https://github.com/xiaobei206/SSTapNext/actions/runs/42343664603
  - Windows build：https://github.com/xiaobei206/SSTapNext/actions/runs/42343664600
- 同一功能合入 main 的代码发布 commit 8f4be60d480e798bf3d17291230454df70674c86：
  - Node CI run 42344552127：success
  - Windows Release run 42344552136：success，创建 v0.3.12 并上传上表三个资产。
- 后续文档提交当时的 main HEAD 9f47df51de7db1463a650126a69cdbcf62eb6970：
  - CI run 42344692593：success
  - Windows workflow run 42344692572：success。因为 v0.3.12 Release 已存在，这次文档 push 不会重建/覆盖同版本安装包。
- 新对话仍需重新查询当前最新 HEAD 和最新 Actions。上述 run 是历史证据，不代表未来代码提交自动通过。

### 重要验证边界

**自动化/CI 已通过，不代表用户 Windows 机器上的真实网络行为已验收。**

截至本交接，尚无用户 Windows 10/11 实机结果可以证明 0.3.12 的以下事项已完成：

- 首次下载上游 SSTap 完整规则库、规则总数/CIDR 数量/上游 SHA 展示；
- 游戏规则 Proxy/Direct 在实际网络中的路由结果，尤其与大陆大范围 CIDR 重叠时的优先级；
- 规则库更新失败后旧版本/current pointer/已选规则保持可用；
- TUN active/transitioning/cleanup_error 时规则更新与路由设置锁定，以及规则更新期间拒绝并发 TUN 启动；
- 真实节点握手、公网出口、浏览器业务、DNS、UDP/QUIC；
- 至少 10 轮真实 TUN connect → disconnect → reconnect，以及 Wintun 清理残留判据。

具体验收逐项见 docs/WINDOWS-ACCEPTANCE.md。不要把这些写成已通过；实际由用户机器测试后逐项记录。

---

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
8. docs/GITHUB-RELEASES.md 与 docs/RELEASE-0.3.12.md —— 当前发布链路与 0.3.12 发布内容。
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

### P0 — 先完成 0.3.12 Windows 实机验收

不要先做无关重构。用户机器尚未提供以下实测证据，按 docs/WINDOWS-ACCEPTANCE.md 的顺序执行并记录：

1. 安装并启动 0.3.12，核对版本显示、启动、节点/订阅、测速和字号。
2. 首次下载 FQrabbit/SSTap-Rule 规则库；核对上游 commit SHA、规则数量、CIDR 数和更新时间。
3. 核对至少一条头字段为 0 的游戏 Proxy 规则和一条头字段为 1 的 Direct 规则。
4. 在真实 TUN 下核对三层顺序：private/LAN → 用户选择规则 → 自动大陆宽表 → GeoSite/GeoIP fallback。特别测试游戏 Proxy CIDR 与大陆 Direct CIDR 重叠的情况。
5. TUN running、启动/停止/recovery、cleanup_error 时，确认规则更新、启停选择、分流/DNS 设置均被阻止；更新进行中 TUN 启动也必须被主进程拒绝。
6. 模拟网络中断/无效 ZIP/损坏规则文件，确认失败不切换 current pointer，原规则和用户选择继续可用。
7. 执行无路由 smoke test；全部通过后再做真实 TUN。真实 TUN 至少 10 轮 connect → disconnect → reconnect，检查核心退出、路由/DNS 恢复、Down 无地址适配器的清理判断和 Up/172.19.0.1 负向保护。
8. 独立验收真实节点公网出口、DNS、浏览器业务、UDP/QUIC。不能用 curl 的单个 HTTP 状态替代完整浏览器/UDP 体验。

记录用户测试输出时对 IP、订阅、节点和秘密做脱敏；不得要求用户公开节点密码/URL。


### P1 — 0.3.13：批量节点检测与测速（代码已实现，发布验收中）

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

**当前正式 Release 仍是 0.3.12；0.3.13 Release 尚未发布。** 新对话接手必须先查 main 当前 SHA、对应 CI/Windows workflow 和 Release。用户 Windows 10/11 实机的 1/2/4/8/16/32 并发压力/系统代理不变/活动连接隔离/取消清理仍未验收。

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