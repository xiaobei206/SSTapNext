> **当前规则优先说明（2026-11-07）：** 本文件是按时间追加的历史日志，旧章节中的分支/PR/发布状态只描述当时情况，不代表现在。新对话请先阅读根目录 **START HERE NEXT GPT.md**。当前唯一开发线为 main；日常不建 feature 分支、不建 PR；**每次开发必须先更新文档再改代码**。最新状态以本文件最末尾的最新日期条目、START HERE NEXT GPT.md 和 GitHub 实时状态为准。早期“main 仍为 0.3.11”“0.3.12 尚在 feature 分支”“Release 待发布”等历史文字均已被后续记录覆盖。

## 当前状态（更新至 2026-11-06）

- 当前源码基线：0.3.7。
- 最近用户确认真实功能可用的版本：0.3.5（用户明确反馈 TUN YouTube 访问正常）；0.3.6 的 Windows 完整构建结果未在对话中确认。
- 0.3.7：修复 Windows 在 sing-box 退出后保留 `sing-tun Tunnel` 适配器对象（`Status=Down`、`Addresses=[]`）导致 Agent 错误写入 `cleanup_error` 的问题。只有接口 `Up` 或仍持有 `172.19.0.1` TUN 地址才构成活动残留；Down 且无地址视为 TUN 已释放，不删除设备对象。
- 0.3.7 自动化：67/67 Node 测试通过；704/704 package-lock 引用通过；全部 JS/CJS/MJS 语法检查通过；doctor 正确识别 0.3.7。当前容器未运行 Windows Agent 编译、54 份 Windows sing-box 核心检查、TS/Vite、NSIS 或真实 TUN 循环。
- 0.3.6 基线 ZIP（唯一来源）：`/mnt/data/SSTapNext-0.3.6-source.zip`，237,323 bytes，SHA-256 `b70b21007945704573beb8019689e52eaee7303f77741e44bad699a849df1b5d`；ZIP 完整性 PASS，MANIFEST 73/73 PASS。0.3.7 由该 ZIP 单一派生，未从其他历史目录混入文件。
- 0.3.7 源码工作树：`/mnt/data/SSTapNext_0.3.7/`；正式源码 ZIP：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-source.zip`（242,075 bytes）；80 条源文件 MANIFEST 与 SHA256 文件位于同一 ReleaseBundle 目录。
- GitHub 目标：`xiaobei206/SSTapNext`（Public）。当前 GitHub 工具列出账号现有仓库但未找到 SSTap 专用仓库；工具没有 create-repository 或 release-asset upload API。需要所有者先建立空 Public 仓库，随后导入源码。发布流水线 `.github/workflows/release-windows.yml` 在 GitHub Release published 后构建 EXE 并上传 EXE、blockmap 和 SHA-256。

## 历史版本时间线

### 0.1.0 / 0.2.0（早期归档）

- 文件库元数据中原先存在 `SSTapNext_0.1.0_source.zip`（61,468 bytes）和 `SSTapNext_0.2.0_source.zip`（85,963 bytes）；本轮已分别移动至 `/sstap/SSTapNext/0.1.0/` 与 `/sstap/SSTapNext/0.2.0/`，原始字节未改。
- 这两个库文件的原始字节当前没有可授权 raw materialize 路径；本轮未读取内部清单/代码，也未把它们作为当前源码基线。后续整理只保留并归档，不推断其功能细节。

### 0.3.0 — Windows TUN 初版基线

- 源码来自本轮对话用户上传的 `SSTapNext-0.3.0-src.zip`（200,170 bytes，SHA-256 `1fd245c0896e7e656febca4c51d4c51da8ada712f51f8c52f0c885765ee692bf`）。这正是 0.3.1 release note 声明的基线来源。
- ZIP 原始成员路径使用 Windows 反斜杠；本轮生成标准化副本 `0.3.0/SSTapNext-0.3.0.zip`，仅将 ZIP entry 分隔符改为 `/`，源文件 bytes 未改，MANIFEST 62/62 仍通过；原始上传包另存为 `SSTapNext-0.3.0-ORIGINAL-UPLOAD.zip`。
- 新增 .NET 10 Windows Agent + UAC；sing-box TUN 接管、双栈地址、auto route/strict route/DNS hijack；全局/绕过中国大陆/自定义规则；Agent 心跳、停止与 stale session 保护。
- 初始 DNS detour 指向空 direct outbound 曾导致 sing-box 运行期退出，随后修复；bypass-cn ruleset URL 补 `geo/` 前缀。详见 0.3.0 包内 `docs/TUN-DEBUG-0.3.0.md` 和 `docs/HARNESS-RESULT-0.3.0.md`。
- 包内交接记录 Node 49/49、sing-box 18/18、Agent/TS/Vite/NSIS build；包内 LOCAL-VALIDATION 另清楚标明当时 Linux 容器未执行 Windows 项目。真实节点握手/公网 TUN 仍未确认。
- 文件库另有旧 `SSTapNext_0.3.0_source.zip`（126,927 bytes），它与用户上传包不同；本轮已从 `/sstap/` 移动至 `/sstap/SSTapNext/0.3.0/`。因当前 Files 工具无 raw-byte materialization，无法核验内部来源/哈希，保留为 `legacy-unverified` 候选，不作为基线。

### 0.3.1 — TUN 适配器归属与清理状态修正

- 基线：用户上传 0.3.0。
- `TunRuntime.cs`：只对启动前已存在且 Up 的同名网卡阻止；记录启动前接口 ID/状态/地址快照，改进 `error` 与 `cleanup_error` 的判定；收紧基于 `172.19.0.1` 的接口识别。
- UI 明确 TUN running 不等于节点公网连通已验证；测试固定串行。
- 用户完整 Windows 输出确认：49/49 tests、sing-box 18/18、Agent publish、TS/Vite、NSIS 安装包全成功。安装包 166.76MB，SHA-256 `B60DC7A57F0E44E76B75EF177B54CE09462493213ABDCA245F55F2B84F4AE331`；Agent SHA-256 `A3C8E00772B3E4689129AD19CE92788D8292C653E5B075C84B2AD8DC206F9347`。
- 期间 PowerShell 5.1 对 npm stderr warning 输出 `NativeCommandError`，但 Build-Windows 后续 8 步全部完成；此类 stderr warning 不能单凭包装消息判定构建失败。

### 0.3.2 — sing-box 停止信号/清理锁修复（但 Windows 编译失败）

- 诊断日志显示 0.3.1 TUN 启动成功（接口 Up、Agent PID），sing-box log 里有 TUN inbound → VLESS selected-proxy 的真实流量；停止阶段进入 `[4/4]` 等待网卡移除，随后出现 `cleanup_error`。
- 根因代码修正：Windows `CTRL_C_EVENT` 不能通过非零进程组 ID 定向；改用 `CTRL_BREAK_EVENT`，并验证进程退出/网卡清理，失败时写残留适配器身份信息；只迁移符合特定条件的已知 0.3.1 stale lock，不删日志/状态/网卡。
- 用户 Windows build 在 `[4/8]` Agent 编译报 `CS0136`：`remainingAdapter` 重复局部变量。

### 0.3.3 — 修复 CS0136（但 npm 安装失败）

- 将正常停止分支变量改为 `retainedAdapter`，保留清理失败分支变量 `remainingAdapter`；测试加源码契约断言。
- 用户 Windows build 在 `[1/8] npm install` 报 `ETARGET`，请求 `@jridgewell/trace-mapping@^0.3.38` 不存在于当前 registry；后续查明为 `package-lock.json` 范围错配，不应归咎于 Windows PowerShell。

### 0.3.4 — npm 锁文件与预检

- 恢复 0.3.2 已成功完成 npm 安装那份依赖图；只更新根项目 version 字段。
- 新增 `scripts/verify-package-lock.mjs`，构建 `[0/8]` 在下载核心和 install 前检查 704 项依赖范围；模拟 `^0.3.38` / 锁定 0.3.31 负例必须失败。
- Release 记录 Node 56/56、704/704、负向检查、离线 package-lock-only 解析通过。没有完整 Windows build transcript 归档。

### 0.3.5 — 适配当前节点不具备 IPv6 出站的环境

- 用户测试证据：节点出口 IPv4 `147.78.245.169`；TUN 下 YouTube IPv4 `HTTP 204`、YouTube API IPv4 `HTTP 405`（TLS/HTTP 可达）；IPv6 两个目标均 Schannel TLS 握手失败；Chrome Direct 仍显示无互联网。
- DNS 默认由 `prefer_ipv4` 调整为 `ipv4_only`；TUN 接口仍双栈、保留 strict route，不让 IPv6 从物理网卡泄漏；独立缓存名 `sing-box-cache-ipv4.db`，同步 Agent 白名单，保留旧缓存。
- Release 记录 Node 59/59、锁文件 704、语法/BOM检查通过。用户随后反馈当前软件已经“完美”。

### 0.3.6 — IPv6 可选、测速多源、按钮交互、核心手动升级、全局字体

- 默认继续 `ipv4_only`；新增 `prefer_ipv4` 和 `prefer_ipv6` 双栈选项，仅在 TUN 断开时可改；Electron IPC 与 Agent 缓存路径白名单必须保持同步。
- 测速 403/404/408/429/5xx/可重试网络错误自动换源：Hetzner 多地区、OVHcloud、Tele2；旧 Cloudflare 默认 URL 自动迁移但不覆盖用户自定义 URL。
- 系统接管按钮增加可用状态、禁用原因、hover/active/focus 反馈。
- 设置页显示实际 sing-box 核心版本、核心目录入口；不自动升级；替换 EXE 必须同时替换同一官方压缩包内的配套 DLL，构建使用目录中当前核心做 54 份配置检查。
- UI 全局显式字体提升；本轮静态计数 97 条显式 px 声明最小 14px。
- 本轮实际在当前容器重新执行 Node 测试 65/65、锁文件 704/704、JS 语法 22/22、PowerShell BOM 6/6、CSS 97/min14；doctor 显示依赖、核心、Agent、前端、NSIS待构建。Windows 完整流水线未执行。

## 已知失败与避免重犯

1. 不要对 `CTRL_C_EVENT` 使用非零 process group id 做定向停止；使用当前 `CTRL_BREAK_EVENT` 实现并验证实际退出。
2. C# `RunAsync` 同方法局部变量不要在嵌套/外层重名；`CS0136` 已在 0.3.3 修复。
3. 不要手工把 package-lock 里的第三方依赖范围改得比锁定版本新；先跑 `npm.cmd run verify:lock`。
4. Windows PowerShell 5.1 脚本必须 UTF-8 BOM。曾有独立诊断脚本无 BOM 导致中文乱码；以后脚本交付前核对前三字节 `EF BB BF`，报告写文件要明确 UTF-8。
5. PowerShell 调 npm 用 `npm.cmd`。npm warning 输出 stderr 不必然等于退出失败，应同时检查 `$LASTEXITCODE` 和流水线最终状态。
6. `running` 仅表明 Agent/core/TUN 条件满足，不代表节点握手、网站请求或出口 IP 已验证。
7. DNS `prefer_ipv4` 是偏好，不等于只返回 A 记录；当前用户环境要 IPv4-only 用 `ipv4_only`，但双栈选项仍保留。
8. `cleanup_error` 不可无条件放行、删除状态文件或随意删除接口；先确认核心 PID 和适配器资源归属。
9. `sing-box` 手动升级需 EXE + 同包 DLL 配套；源码包默认 Fetch 锁继续是 1.14.4，不会自动升级。

## 当前尚未完成

- 0.3.6 在用户 Windows 环境完整执行 `Build-Windows.ps1` 并保存全量构建日志。
- 对实际核心执行 54 份协议×模式×DNS 配置 `sing-box check`。
- .NET 10 Agent build、TypeScript/Vite、NSIS 安装包。
- 安装 0.3.6 后验收 IPv4 默认模式、测速 fallback、按钮交互、字体可读性、核心目录入口。
- 在真实具备 IPv6 节点出口的环境验证 `prefer_ipv4` / `prefer_ipv6` 双栈策略。
- 对 0.1.0/0.2.0 旧文件库 ZIP，目前只有元数据；若未来需要复盘，先解决 raw file access 并核验内部版本/哈希，不要用其拼接当前代码。

## 当前可信源与交接文件路径

以下为本轮本地整理包中的实际路径；同名文件库目标路径尚未上传，不能当作已同步：

- 0.3.6 源码 ZIP：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6.zip`。
- 0.3.6 HANDOFF：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6-HANDOFF-CN.md`。
- 0.3.6 BUILD REPORT：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6-BUILD-REPORT.md`。
- 0.3.6 MANIFEST：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6-SOURCE-MANIFEST.sha256`。
- 0.3.6 ZIP SHA：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6-SHA256.txt`。
- 0.3.6 Windows 验收：`/mnt/data/SSTapNext_Project/0.3.6/SSTapNext-0.3.6-Windows-验收命令.txt`。
- 文件库目标目录：`/sstap/SSTapNext/0.3.6/`；本轮上传限额导致以上新文件均未上传。

## 本次文件标准化工作（2026-11-05）

- 当前 0.3.6 ZIP、MANIFEST 实际读取并逐项核验；没有修改任何源码。
- 把 0.3.0–0.3.6 源码 ZIP 及版本配套文件整理到各自独立版本目录；0.3.0 额外保留原始上传 ZIP。
- 建立本文件和 `PROJECT-OVERVIEW-CN.md`，提供新对话接手顺序、架构边界、完整版本时间线和未完成事项。
- 文件库同步只以每个 upload/move 结果为准；未成功的文件必须在最终报告逐项列明。


### 文件库同步结果（2026-11-05，本次任务结束状态）

- 成功移动到正式版本目录：0.1.0、0.2.0、旧版文件库 0.3.0 ZIP；成功将 6 份原有 0.3.0 根目录文档移动至 `/sstap/SSTapNext/0.3.0/docs-legacy/`。移动均保留原始文件 ID/字节，不删除。
- 创建文件库目录 `/sstap/SSTapNext/0.3.0/docs-legacy/` 成功。
- 尝试上传新建的总体说明、主开发日志、归档索引/验证 JSON、0.3.0 标准交付文件时，Files 上传结果返回平台限制：`You've reached our limit of file uploads. Please try again in 6 hours.`；其他同批条目返回 `container_session_expired`。本次新文件上传成功数为 0，未重复重试。
- 新标准化文件已全部保存在本地 `/mnt/data/SSTapNext_Project/`，并可作为单独附件/完整 ZIP 提供；文件库目前只有旧材料的成功移动，尚未包含本轮新标准化文档和标准 0.3.0–0.3.6 ZIP。
- 0.1.0/0.2.0/旧 0.3.0 候选 ZIP 的原始字节在当前 Files 工具无法 materialize，不纳入内部哈希通过数；原有库文件已保留其原文件名和 metadata。


## 2026-11-06 — 0.3.7：Wintun Down 持久化对象误报与 GitHub 发布链路

### 基线和证据

- 可信基线：`/mnt/data/SSTapNext-0.3.6-source.zip`，237,323 bytes，SHA-256 `b70b21007945704573beb8019689e52eaee7303f77741e44bad699a849df1b5d`；ZIP 完整性通过，73/73 MANIFEST 文件匹配。
- 在修改前，从该 ZIP 解压出的源码实际运行 `node --test --test-concurrency=1 src/shared/*.test.mjs`，65/65 PASS；`node scripts/verify-package-lock.mjs` 显示 704/704。
- 用户新错误：sing-box PID 24372 已退出；接口 `Name=SSTap Next; Description=sing-tun Tunnel #3; Status=Down; Type=53; Addresses=[]`，18 秒后 Agent 仍写 `cleanup_error`。
- 根因：0.3.6 `IsSessionResidualAdapter()` 在启动前没有接口快照时，只要同名接口对象仍存在就无条件返回 true。Windows 保留的 Down、无地址 Wintun 设备对象因此被误当成活动会话资源。

### 方案与修改

- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`：新增 `IsAdapterOperationallyActive()`。仅当 `OperationalStatus == Up` 或仍持有固定 TUN 地址 `172.19.0.1` 时，接口才可能是活动残留。Down 且无 TUN 地址时认为本次 TUN 已释放；保留该适配器对象，不调用删除/禁用网络接口的 API。
- 正常停止日志现在区分“接口对象已移除”和“Windows 保留 Down/无地址的 Wintun 对象”。
- `src/shared/agent-stop-contract.test.mjs`：新增两个源码契约回归，分别保护 Down/无地址的放行条件，以及 Up/仍有 TUN 地址时的安全锁。
- 版本号统一升级为 0.3.7；更新 package.json/package-lock 根版本、Agent、主进程、UI、doctor、构建输出和依赖 User-Agent。未升级第三方 npm 依赖或 sing-box 版本。
- 新增 `.github/workflows/ci.yml`：push/PR 上运行 npm ci、Node tests 和锁文件检查。
- 新增 `.github/workflows/release-windows.yml`：发布 Release 后在 Windows 2022 上运行 `Build-Windows.ps1`，并上传安装 EXE、blockmap 和 SHA-256。
- 新增 `docs/GITHUB-RELEASES.md`，记录首次公共仓库创建和后续发布步骤。

### 本轮验证

- 0.3.6 基线 Node tests：65/65 PASS。
- 0.3.7 Node tests：67/67 PASS。
- package-lock 引用：704/704 PASS。
- JS/CJS/MJS `node --check`：全部通过。
- `doctor`：检测到项目版本 SSTap Next 0.3.7 正确；依赖、Windows sing-box 核心、Agent、Vite 产物和安装包均标记待构建。
- Windows .NET Agent 编译：NOT RUN（当前容器无 Windows/.NET 10 SDK）。
- sing-box Windows 核心 54 项 check：NOT RUN。
- TypeScript/Vite、NSIS、Windows 实际 TUN 循环测试：NOT RUN。
- GitHub Actions：工作流文件已写入源码，尚未推送/运行。

### GitHub 仓库权限边界

已通过连接枚举 `xiaobei206` 可访问的仓库；当前列表中没有 `SSTapNext` 或 SSTap 专用仓库。当前 GitHub 工具支持读取仓库、提交文件/Blob/Tree/Commit/Ref，但没有创建新仓库、创建 Release 或直接上传二进制 Release 资产的接口。没有把项目误放进 `padavan-4.4-2`、Netch 或其他无关仓库。目标为 `xiaobei206/SSTapNext`，需要仓库所有者先创建空的 Public repository；其后由 Release workflow 自动构建和上传安装资产。

### 下一步

1. 仓库所有者创建空 Public repository `xiaobei206/SSTapNext`，并提供仓库 URL。
2. 将 0.3.7 当前源码提交到 `main`，核对 GitHub 文件树和版本。
3. Windows 构建 `Build-Windows.ps1`，确认 Agent 编译、54 份核心配置、Vite、NSIS。
4. 实测至少 10 轮 TUN connect → disconnect → reconnect；Down/无地址接口不应再造成 `cleanup_error`；Up/仍有 `172.19.0.1` 必须继续阻止重连。
5. 发布 `v0.3.7`，确认 Actions 成功并在 GitHub Release 下载 EXE 与 SHA-256。


### 0.3.7 当前归档元数据（2026-11-06）

- 正式源码 ZIP：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-source.zip`
- ZIP 大小：242,075 bytes。
- ZIP SHA-256：`7d894b79f9851ddbf99106a95b430fe8ddf481e127bc5dd0ff8975cbd4841f76`。
- ZIP 内部顶层目录：`SSTapNext_0.3.7/`；81 个 ZIP 成员（80 个源码/文档条目 + `SOURCE-MANIFEST.sha256`）。
- 逐文件清单：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-SOURCE-MANIFEST.sha256`，80 条文件哈希；清单自身不对自身哈希。
- 版本交接：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-HANDOFF-CN.md`。
- 构建报告：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-BUILD-REPORT.md`。
- Windows 验收命令：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-Windows-验收命令.txt`。
- ZIP 外 SHA 文件：`/mnt/data/SSTapNext-0.3.7-ReleaseBundle/SSTapNext-0.3.7-SHA256.txt`。
- 主开发日志 `PROJECT-DEVELOPMENT-LOG-CN.md` 作为 GitHub 仓库根目录长期文件保留，不打入版本源码 ZIP，避免其记录 ZIP 的 SHA-256 后产生自引用；MANIFEST 因此不包含该项目级唯一日志。GitHub 仓库初始化时应提交该日志。
- ZIP 完整性、顶层目录、内部逐文件 SHA、外部 MANIFEST 字节一致性和外部 SHA 文件已在归档生成后交叉验证；详见本轮交接报告。
- GitHub 状态：`xiaobei206/SSTapNext` 不存在（`get_repo` 返回 404）；当前连接没有创建 repository 的动作。未向其他仓库提交。需要 owner 先创建空 Public 仓库后再上传本源码树。

## 2026-11-07 — 0.3.12 SSTap 经典规则兼容、转换与在线更新

### 当前分支与交付状态

- main 仍为 0.3.11；0.3.12 开发位于 feature/sstap-rule-library-0312，由 PR #1（https://github.com/xiaobei206/SSTapNext/pull/1）承载，当前尚未合并。
- 上一轮并非丢失：PR 已包含原版 .rules 解析、下载转换、规则库管理 UI、Electron IPC、TUN rule-set 注入和文档。
- 本轮接手后修复了新规则库字号低于 14px 的 CI 回归；没有降低或删除既有字体测试。
- 将 .github/workflows/windows-build.yml 增加 pull_request 触发。PR 中执行 Windows 完整构建、验证产物并上传 workflow artifact；PR 不创建正式 GitHub Release。
- 修正了分流优先级：bypass-cn 的自动 BypassCNandLan.rules 必须排在用户显式选择的游戏规则之后，避免重叠 CIDR 被提前判成 Direct，从而吞掉游戏 Proxy 规则。新增回归断言保护这一顺序。
- 将 sing-box 核心配置检查从原 54 组协议/模式/DNS 组合，扩展为额外校验 1 份包含 proxy/direct SSTap 本地 source rule-set 的真实配置；Windows 构建输出相应说明 54+1。
- 更新 HANDOVER.md、docs/SSTAP-RULE-CONVERSION.md、docs/WINDOWS-ACCEPTANCE.md、docs/TEST-PLAN.md、PROJECT-OVERVIEW-CN.md 等接手文档。后续对话应以 HANDOVER.md 与 PR 最新 HEAD 为准，不再使用过时的 0.3.7 开发入口描述。

### 上游格式独立核验

- 上游仓库：FQrabbit/SSTap-Rule，默认分支 master；检查时的 Git tree SHA 为 d0779fe5924ba02b0df3a917e61ea32a409b8a03，当时包含 190 个 .rules 文件。
- 实际读取 BypassCNandLan.rules 的头部：第三字段为 1，对应 Direct。
- 实际读取 League-of-Legends-us.rules 的头部：第三字段为 0，对应 Proxy。
- 上游根目录许可证为 Apache License 2.0；转换器把 LICENSE 与版本化规则数据一起保存。
- .rules 下载包以 commit SHA 固定版本；ZIP 条目大小、路径、压缩方式和 CRC-32 均验证后才解析。无效文件不会部分导入；失败更新不替换 current pointer，保留已有有效版本。

### 本轮 GitHub Actions 证据

- PR #1 在旧 HEAD 6ef901b90191c3d60c450f78d89bacd0464063f1 上，Node CI 运行 42342702709 成功；Windows 完整构建运行 42342702757 成功，覆盖 npm ci、锁文件检查、Node tests、sing-box 检查、.NET 10 Agent、TypeScript/Vite、NSIS 安装包、SHA-256 与 artifact 上传。
- 上述成功记录早于游戏规则优先级修复和额外本地 source 规则集核心检查；不得把旧 HEAD 的成功结果冒充当前最新 HEAD 验证。
- 后续提交已触发新一轮 PR Actions；最终合并前必须重新检查 PR 最新 HEAD 的 Node CI 与 Windows Build 均为 success。
- 自动 Windows build 不执行真实节点握手、公网出口、TUN 路由/DNS 实机和多轮 Wintun 清理；这些仍需 Windows 10/11 设备按 docs/WINDOWS-ACCEPTANCE.md 手工验收。

### 接手约束与下一步

1. 只在 feature/sstap-rule-library-0312 / PR #1 上继续开发；不要直接向 main 写入 0.3.12 未验收功能。
2. 每次更新后先核对 PR 最新 HEAD，再看对应 commit 的 Node CI 与 Windows Build；被新提交取消的旧 run 不算验证通过。
3. 重点保留三层优先级：private/LAN 安全直连 → 用户显式游戏/规则集 → 自动大陆 IP 与 GeoSite/GeoIP fallback；其中自动大陆规则不能先于用户游戏规则。
4. 不允许在 TUN running/transitioning 时更新规则库或更改启用选择；不允许下载/转换失败覆盖旧 current pointer。
5. PR 合并后，仍需通过 Windows 实机确认规则下载、启动 TUN、bypass-cn/游戏覆盖、更新失败回滚和 10 轮 connect/disconnect；真实公网路径和 UDP/QUIC 单独记录。
### 追加安全审查 — 规则更新与 TUN 生命周期互斥（2026-11-07）

- 发现仅在 IPC 进入时读取一次 Agent status 仍有竞态：TUN 可能在规则更新排队期间启动；反之规则库下载/转换期间也可能有 TUN connect 请求进入。
- TunController.isRuleLibraryMutationLocked() 现在同时检查 retained session、start/stop/recovery Promise，以及 requested/awaiting_uac/starting/running/stopping/cleanup_error 状态。启动前的 stale-session recovery 也纳入锁，不依赖 UI 是否及时收到状态事件。
- Electron 主进程增加 ruleLibraryUpdating 互斥标志；更新 handler 进入 mutation queue 后重新检查 TUN 状态，再持有标志直到下载、转换、active pointer 切换和设置 pruning 全部结束。TUN connect 在加载 state 前后检查更新标志；进入 controller 后，in-flight start Promise 会阻止 updater 竞争。
- 修改 routing mode/custom rules/enabledRuleIds 的设置操作，同样在 mutation queue 内检查 controller lock 和 updater flag。
- Renderer 中，TUN start 按钮在规则更新期间禁用；分流和 DNS 设置在 cleanup_error 以及所有启动/停止过渡期间锁定。UI 是可用性提示，Electron IPC/controller 是强制安全边界。
- 新增 3 条自动化回归：控制器启动/运行/正常停止期间锁定与解锁、cleanup_error 锁定、Electron/Renderer 互斥契约。当前最新 PR HEAD 的 CI 尚待运行完成；不得把旧 HEAD 的成功结果当作该补丁的验证证据。

## 2026-11-07 — 0.3.12 合入 main 与个人项目开发流程调整

- 用户明确要求：这是个人项目，日常不要再建立 feature 分支或 PR；GitHub main 作为唯一开发线，出问题用 Revert 回滚，正式版本用递增版本号 + Tag + Release 留档。
- PR #1 已通过 Squash 合入 main；PR 状态 closed/merged。
- main 发布提交：8f4be60d480e798bf3d17291230454df70674c86，标题 release: SSTap Next 0.3.12。
- PR 合并前最新源代码 HEAD b22ab5081f52a7fa57ddc8e583197ba634b7e69f 的验证：Node 86/86、package-lock 704/704、sing-box 55/55、Windows x64 Agent/TS/Vite/NSIS 安装包/SHA-256/artifact 均通过。
- main push 后 Node CI run 42344552127 已通过；Windows 正式 Release workflow run 42344552136 在本日志记录时仍处于 Build-Windows 步骤，Release v0.3.12 尚未从 GitHub Releases API 核实。必须再检查 run 状态、Release tag 与资产，不能只凭 workflow 已启动宣称已发布。
- 后续开发规则：直接在 main 开始工作；任何正式用户可见功能迭代先升正式版本号并同步所有版本来源；提交 main；GitHub Actions 完成验证后创建 vX.Y.Z Release（EXE、blockmap、SHA-256）。若发现缺陷，在 main 直接修复并递增版本，必要时 Revert 错误提交，不创建长期 feature 分支。
- GitHub PR #1 是本轮迁移遗留记录，不作为今后工作入口。旧分支 feature/sstap-rule-library-0312 未再接收提交；当前 GitHub connector 不提供删除 Git ref 的动作，因此该旧分支暂时保留但已停止使用。


## 2026-11-07 — 0.3.12 Release 实际核验与 NEXT GPT 文档优先接力体系

### Release 最终状态（覆盖本日志前文“Release 尚待核实”的当时状态）

- GitHub Release：`v0.3.12` 已于 2026-11-07T05:55:28Z 发布。
- Release 页面：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.12
- Tag target：`8f4be60d480e798bf3d17291230454df70674c86`。
- Windows Release workflow：run `42344552136`，completed / success。
- Node CI：run `42344552127`，completed / success。
- EXE：`SSTap.Next-0.3.12-x64.exe`，174,882,504 bytes，SHA-256 `42c700f4234b50e1ee31392d84d405954c3ad773aa8778201914900a792f3cdd`。
- Blockmap：`SSTap.Next-0.3.12-x64.exe.blockmap`，182,676 bytes。
- SHA sidecar：`SSTap.Next-0.3.12-x64.exe.sha256`，93 bytes。
- PR 最新功能 HEAD `b22ab5081f52a7fa57ddc8e583197ba634b7e69f` 的 Node tests 86/86、package-lock 704/704、sing-box 55/55、Windows x64 Agent、TypeScript/Vite、NSIS 和 SHA 构建通过；对应 Node CI run 42343664603、Windows build run 42343664600。
- 文档提交的历史验证：main HEAD `9f47df51de7db1463a650126a69cdbcf62eb6970` 的 CI run 42344692593 success，Windows workflow run 42344692572 success。因 v0.3.12 Release 已存在，后者不会重建/覆盖已发布安装包。

### 对前文临时状态的说明

本日志上一节在 Release workflow 执行期间记录“Release 尚未从 API 核实”，那是当时真实状态，不是最终状态。现已通过 GitHub Releases API 直接确认 tag、target commit、发布时间和三个资产均存在。上一节中“main 仍为 0.3.11 / 0.3.12 在 feature 分支 / 只在 PR 开发”等文字也仅作为历史过程保留，均已被 PR 合并与后续 main-only 流程覆盖。不得再按历史段落操作。

### 新 GPT 无缝接手文件

- 新增仓库根目录 `START HERE NEXT GPT.md`：专门面向新对话，集中说明当前代码和 Release 状态、模块位置、安全不变量、已通过验证、尚未实机验收事项、下一步队列和上下文结束前交接模板。
- 更新 `README.md`：顶部明确链接 START HERE，并写明 main-only 与 docs-first 规则。
- 更新 `HANDOVER.md`：添加新 GPT 接手规则、最新 Release 事实、未完成实机验收、安全边界；明确其补充规则覆盖历史临时工作流指令。
- 更新 `PROJECT-OVERVIEW-CN.md`：修正 main/Release 状态与历史 PR 描述；补充第一入口、真实目录结构、文档优先和上下文耗尽交接流程。
- 更新 `docs/TEST-PLAN.md`：将状态改为已发布 0.3.12，修正 Node 86/86 基线，记录 CI/Release run 与实机测试边界。
- 更新 `docs/WINDOWS-ACCEPTANCE.md`：修正来源为 main 当前 HEAD，Node 测试基线 86，声明未经用户实测的复选项不能视为通过。
- 以上文档更新均在 main 直接提交；不新建分支或 PR。

### 后续开发强制约束（用户明确要求）

1. **每次新工作先写文档再写代码**，对功能、重构和 bug 修复均适用。必须先记录目标、现状、设计、影响文件、安全约束、验收标准、测试与回滚方案。
2. 开发过程中出现设计变更/范围变化时即时改文档，不可把文档留到最后。
3. 上下文快到上限时停止代码修改，先更新 START HERE、HANDOVER 和本日志，明确最后一个 commit、修改文件、已跑测试、NOT RUN、待办和下一步唯一动作。
4. 只在 main 开发；日常不建立 feature branch / PR；正式版本递增 SemVer，GitHub Actions 验证并自动发布，问题用 Revert。
5. 新 GPT 先读 START HERE，再读 HANDOVER、PROJECT-OVERVIEW、开发日志和任务对应专题文档；实时核对 GitHub main、Actions 和 Release，不依赖上次对话总结。

### 当前真正未完成事项

- 0.3.12 用户 Windows 10/11 实机验收仍未见证据：规则库实际下载/更新、代理/直连路由、bypass-cn 重叠 CIDR 优先级、更新失败保留旧 current pointer、TUN/规则更新互斥、节点公网出口、DNS、UDP/QUIC、至少 10 轮 TUN 清理。
- 详见 `docs/WINDOWS-ACCEPTANCE.md`；CI 通过不代表实机通过。
- 下一对话第一步：读取 START HERE NEXT GPT.md，刷新 main 当前 HEAD 和相应 Actions，然后继续 P0 Windows 实机验收或根据用户最新目标处理。

## 2026-11-07 — 0.3.13 批量节点检测/测速需求与文档先行设计

### 用户确认的需求

- 节点管理列表直接显示各节点的 PING、TCPING、真实代理延迟、下载速度，不必去单独测速页面查看。
- 一键全部节点检测，也支持仅检测选中节点；逐节点更新结果；可随时取消。
- 批量并发节点数可选 1 / 2 / 4 / 8 / 16 / 32。
- 用户网络为 500 Mbps，常用测速文件 10 MB；多节点可以同时跑，不必逐个等待。
- 当前单节点测速启动阶段看起来像“生成系统代理”，用户认为慢，希望参考 v2rayN 的便利体验。

### 当前源码事实（本轮重新读取 main）

- Renderer runSelectedSpeedTest() 仅传一个 selectedNodeId，当前不支持批量测速。
- Electron IPC sstap:speed-test 调用 CoreController.connect(node) 建立临时单节点 sing-box 会话（除非已连接同节点），然后调用 downloadSpeedTest() 通过 127.0.0.1 的本地 SOCKS5 入口下载；结束时断开临时会话。
- CoreController 会生成临时 JSON、执行 sing-box check、spawn sing-box，并轮询本地 SOCKS5 握手端口（等待窗口最多 15 秒），这才是启动测速前的额外耗时。
- 重要纠正：现有 src/shared/singbox-config.cjs 的 mixed inbound 明确 set_system_proxy:false，listen=127.0.0.1。当前测速并没有切换 Windows 系统代理；它启动的是应用内部测速用的本地 SOCKS5 核心。
- 当前 speedTestThreads 仅为单个节点下载 HTTP Range 分段 worker 数，允许 1/2/4/8；不是并发节点数。
- 单例 CoreController 只允许一条活动节点连接；测速另有 TUN unsafe 状态拒绝检查。不能用反复 connect/disconnect 单例来做多节点批测，也不得中断用户实际活动连接。

### v2rayN 当前源码参考

- 仓库文件：2dust/v2rayN / ServiceLib/Services/SpeedtestService.cs。
- RunTcpingAsync：对节点地址/端口直接并发 TCP connect，属于 TCPING，不需要通过节点代理。
- RunMixedTestAsync：MixedConcurrencyCount 控制同时测试的节点数；每个 node task 创建独立临时测试核心/本地 SOCKS，执行真实代理延迟和下载，finally 停止该测试核心。
- RunRealPingAsync 可将一批节点放在一个测试核心配置中并发请求。
- 在线核对引用：`https://github.com/2dust/v2rayN/blob/master/v2rayN/ServiceLib/Services/SpeedtestService.cs`。
- 本轮不是简单复制 v2rayN；重点借鉴批量调度、节点结果即时回填、专用测试核心隔离、取消生命周期；32 并发必须有界并做资源压力验证。

### 文档先行提交

- 新增 `docs/CONCURRENT-NODE-TESTING.md`：记录完整目标 UI、三类指标定义、并发参数语义、当前测速链路与慢点、v2rayN 源码参考、隔离/安全要求、技术方案和自动化/Windows 验收清单。
- 更新 `START HERE NEXT GPT.md`：将 0.3.13 批量节点检测列为下一版 P1 队列，并明确本功能尚未开始写代码。
- 更新 `HANDOVER.md`：补充当前测速原因、set_system_proxy:false 的核验结论、v2rayN 参考和 0.3.13 安全约束。
- 更新 `docs/TEST-PLAN.md`：新增批量节点检测自动化与实机验证要求。
- 本轮只修改文档，**未修改任何运行时代码，未升级版本号，未创建 v0.3.13 Release**。

### 实现阶段必须保持的设计

1. 1/2/4/8/16/32 表示“同时测速节点数”，与每个节点下载文件时的 Range 分段数明确区分。
2. PING=ICMP；TCPING=原始 TCP connect；真实代理延迟=经节点协议连接后发 HTTP 请求；下载测速=10 MB Range download。不能混用/互相替代。
3. Hysteria2 是 UDP/QUIC，TCPING 显示不适用。
4. 节点页直接显示四种结果与最后测试时间；支持全部/选中节点、实时进度与取消。
5. 新建专用 batch runner / 有界 worker pool，不使用主 CoreController 来回切节点；不自动修改 Windows 系统代理；不切换或断开用户正在使用的节点。
6. 测试核心 loopback-only 且 set_system_proxy:false；进程、临时配置、端口可归属、可取消、可清理。
7. TUN 安全锁和 cleanup_error fail-closed 保护保持不变。
8. 用户 500 Mbps 共享出口多节点并测会争用同一带宽；记录每节点 bytes/elapsed/threads/结果时间，UI 可说明并发测量结果为共享带宽状态。

### 下一步

- 实施前重新读 START HERE NEXT GPT.md 与 docs/CONCURRENT-NODE-TESTING.md。
- 正式代码迭代版本升至 0.3.13，先同步所有版本字段、发布说明，再逐步实现 runner、IPC、Renderer 节点列表和测试。
- 在 Windows runner 与用户机器上实测 1/2/4/8/16/32 并发资源、系统代理保持不变、活动连接隔离与取消清理。


### 0.3.13 实施设计定稿（2026-11-07，代码修改前）

- 批量测速明确采用每批一个临时 sing-box 进程，多个 loopback mixed inbound + 多个 node outbound，使用 inbound route 将各端口流量锁定到对应节点 outbound。所有 inbound set_system_proxy:false。
- 批量节点并发 batchTestConcurrency 默认 4，选项 1/2/4/8/16/32；每批最多 32 个节点，更多节点分批。
- 每节点下载 Range 线程 speedTestThreads 扩展 1/2/4/8/16/32。全局 Range worker 总预算 64，根据批测并发数计算有效线程，防止乘法放大。
- PING 走 Windows ping.exe 3 次；TCPING 走 Node TCP connect；真实代理延迟/10 MB 下载复用 SOCKS 测速模块。Hysteria2 的 TCPING 为 N/A。
- 结果按 nodeId 存入受限 nodeTestResults；支持全量/勾选节点、逐节点事件回填和取消。独立 runner 不操作主 CoreController；TUN 不安全状态下拒绝批测。
- 批量 sing-box 配置加入 Build-Windows 的真实核心校验，将配置矩阵从 55 增至 56。
- 本条记录在代码开发前提交；尚未修改运行时代码和版本号。



## 2026-11-07 — 0.3.13 批量节点检测与测速代码实现阶段（续）

### 已实现内容

- 独立 runner：新增 src/shared/batch-node-test.cjs，不使用主 CoreController 来回切节点。
- 批测 sing-box：每批最多 32 节点，仅启动一个临时 sing-box 进程；每节点独立 loopback mixed inbound 和 outbound，通过 inbound route 精确绑定；未匹配路由 final=block；所有 inbound set_system_proxy=false。
- 指标：Windows ping.exe 三次 ICMP PING（英语/中文输出解析）、原始 TCP socket TCPING 三次、经节点自身 SOCKS inbound 的 HTTP 真实代理延迟和 Range 下载；Hysteria2 的 TCPING 显示 N/A。
- 参数：batchTestConcurrency=1/2/4/8/16/32（默认 4）；speedTestThreads=1/2/4/8/16/32；Range worker 总预算固定 64，按本批有效并发节点数向下选支持档位，覆盖 3、5 等非 2 的幂次节点数量。
- IPC：增加 start/cancel/progress，校验 renderer 来源、节点 ID、并发档位、节点数量和 TUN 安全状态；应用退出时取消并等待批测清理。
- 结果：按 nodeId 保存到加密状态 nodeTestResults，上限 512；每节点实时回填，删除节点后持久化时清理孤儿结果。
- UI：节点管理支持全部/选中、全选、并发和 Range 线程设置、保存参数、取消、进度；列表直接显示 PING/TCPING/代理延迟/下载/最近检测时间。
- 新增 src/shared/batch-node-test.test.mjs 覆盖本地化 PING、PING 取消等待 close、TCPING、Range budget、批量路由、worker pool、单节点失败隔离、单批单进程集成和取消清理。
- scripts/validate-singbox-configs.mjs 增加两节点批测配置的真实 sing-box check；目标从 55 项增至 56 项。

### 发现并修复的实现回归

- 首轮 worker 完成计数测试发现统计数据不正确；修复任务结果计数与 active 进度。
- 取消测试暴露 worker pool Promise.all 提前拒绝的问题；改为 Promise.allSettled 等待所有任务 settle 后再清理进程。
- 修复 _startSession 在 spawn 后发生取消时过早 throw、导致 session ownership 未交给 finally 清理的竞态。
- Windows 全局字号契约发现来源标识 13px；已提升到 14px。
- 补上中文 Windows ping.exe “时间=...ms”解析和 ICMP 子进程等待 close。
- 修正有效 Range worker budget 对 3、5 等非 2 的幂次并发节点数的处理，向下取可支持的线程档位。

### 当前验证/发布状态

- 本节写入时仍需以最新 main SHA 对应 GitHub Actions 为准；此前有失败和取消的旧 runs，不可拿旧 SHA 成功代替。
- 0.3.12 是最新正式 Release；0.3.13 版本号与 Release notes/资产尚待最后一轮版本统一和构建验证。
- 用户 Windows 10/11 实机的 1/2/4/8/16/32 并发 CPU/内存/共享带宽、系统代理状态、现有连接隔离、取消清理尚未运行（NOT RUN）。CI 成功也不等于实机已验收。

### 下一步唯一动作

1. 先核验当前 main HEAD 的 Node CI 具体失败/通过测试数，以及 Windows workflow 的 56 项 sing-box check、Agent、TypeScript/Vite、NSIS、SHA 步骤。
2. Node CI 通过后，将 package.json/package-lock、Agent、Build script/doctor、README/CHANGELOG 和 docs/RELEASE-0.3.13.md 一次性同步正式版本号 0.3.13。
3. 验证 v0.3.13 Release 与 EXE、blockmap、SHA-256 三个资产；如 workflow 失败，先修复并递增修订版本，不能手工宣称发布成功。
