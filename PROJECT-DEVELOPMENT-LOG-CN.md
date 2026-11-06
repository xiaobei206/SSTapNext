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
