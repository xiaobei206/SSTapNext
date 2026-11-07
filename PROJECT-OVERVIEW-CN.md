# SSTap Next 项目总体说明

## 1. 项目标识与当前状态

- GitHub 仓库：`https://github.com/xiaobei206/SSTapNext`；main 是唯一可信开发线。
- 当前正式版本：**0.3.13**；GitHub Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.13。0.3.13 批量节点检测已发布；Node CI 97/97、lock 704/704、sing-box 56/56 与 Windows x64 安装包构建已通过。用户实机并发压力与连接隔离验收仍未完成。
- 0.3.12 功能代码进入 main 的发布 commit：`8f4be60d480e798bf3d17291230454df70674c86`。其后的 main 提交为交接/文档维护，不代表另一个程序版本；新对话必须动态检查 main 最新 SHA。
- 0.3.12 Release 已含 Windows x64 安装程序、blockmap 和 SHA-256。发布工作流 run `42344552136`、Node CI run `42344552127` 均成功；PR 最新功能 HEAD 的 Node 86/86、package-lock 704/704、sing-box 55/55、Agent、TS/Vite、NSIS 构建也通过。
- 0.3.12 增加原版 FQrabbit SSTap `.rules` 转换、规则库在线更新、分流页面规则管理、游戏规则叠加和优先级保护。**真实 TUN/Wintun、规则库运行时行为和节点公网链路仍需用户 Windows 设备验收**，见 `docs/WINDOWS-ACCEPTANCE.md`。
- 近期用户确认真实功能可用的历史版本：**0.3.5**（用户反馈系统级代理/YouTube 已恢复正常；不可将此反馈外推为 0.3.12 的实机验收）。
- 新对话第一入口：根目录 `START HERE NEXT GPT.md`；随后读 `HANDOVER.md`、本文件和 `PROJECT-DEVELOPMENT-LOG-CN.md`。不要从旧 0.3.7 ZIP 拼接源码。
- 用户明确要求的开发纪律：这是个人项目，日常直接在 main 开发，不新建 feature 分支或 PR；**每次开发必须先更新文档、写清目标/方案/验收/风险，再修改代码**；正式迭代递增版本号，main 提交触发 Windows 构建/Release，问题通过 GitHub Revert 回退。

## 2. 用途与功能

SSTap Next 是 Windows 代理客户端，提供节点/订阅导入、sing-box 本地 SOCKS/HTTP mixed 代理、节点测速、Windows 系统级 TUN、全局/绕过中国大陆/自定义规则分流、DNS 地址族策略和手动 sing-box 核心升级。

### 当前 main 0.3.13 正式功能基线

- 节点协议：VLESS、Hysteria2、Shadowsocks SIP002、VMess、Trojan，以及已实现的 TLS/Reality/WebSocket/gRPC/混淆参数边界。
- 订阅：单节点、多节点、Base64 列表、刷新、稳定 ID、来源管理、失败原子保留旧列表。
- 凭据：Electron `safeStorage` 可用才保存/解密；不得降级写明文。
- 本地代理：sing-box mixed inbound，仅监听 `127.0.0.1`，不自动改 Windows 系统代理。
- 单节点测速：通过选中节点 SOCKS5，Range/多线程/取消/历史记录，并有多个公开测速源回退。
- 批量节点检测（0.3.13）：节点页一键全部/勾选检测，显示 ICMP PING、TCPING、代理 HTTP 延迟、下载 Mbps 和检测时间；并发 1/2/4/8/16/32；每批一个临时 sing-box 会话承载多个 loopback inbound/outbound，Range 总 worker ≤64；逐节点结果加密持久化。Windows 实机压力和连接隔离验收仍须完成。
- 系统 TUN：独立 .NET 10 Agent 经 UAC 启动 sing-box，双栈 TUN、auto route、strict route、DNS hijack；三种分流模式。
- DNS：默认 `ipv4_only`；用户可选 `prefer_ipv4` 或 `prefer_ipv6` 双栈策略。双栈要求本地接入网络和所选代理节点出口都支持 IPv6。
- sing-box 核心：默认下载脚本仍锁定 1.14.4；软件读取实际核心版本；用户可以手动升级 EXE 和同包 DLL。Windows 构建执行 54 组协议/模式/DNS 地址族配置检查，并额外检查 SSTap 本地 source 规则集配置。 
- SSTap 规则库：按上游 commit 下载 FQrabbit/SSTap-Rule ZIP，校验 CRC/大小并转换到 sing-box local source JSON；保存于用户数据目录，版本指针原子切换，更新失败保留旧库。原规则头动作 `0=proxy`、`1=direct` 原样映射。
- 规则叠加：全局代理、绕过中国大陆、自定义规则三种基础策略可加载用户勾选的 SSTap 规则；绕过大陆时自动加载旧版大陆规则，但所选游戏规则优先于该自动规则以及 GeoSite/GeoIP 回退。

## 3. 技术架构与模块边界

| 模块 | 实际目录 | 职责 |
|---|---|---|
| Electron 主进程 | `apps/desktop/src/main/` | IPC、窗口安全、核心/Agent调用、用户数据与测速/连接协调 |
| Preload | `apps/desktop/src/preload/` | 暴露最小化 renderer API；保持 contextIsolation、sandbox、安全来源检查 |
| React UI | `apps/desktop/src/renderer/src/` | 页面、设置、交互、状态与样式 |
| Shared CJS | `src/shared/` | 节点解析/注册、sing-box配置、核心生命周期、SOCKS测速、TUN配置与控制 |
| .NET Agent | `src/agent/SstapNext.Agent/` | UAC后运行，校验会话与文件，控制 sing-box 和 TUN 资源，写入状态/日志 |
| Scripts | `scripts/` | Windows构建、核心下载、Agent发布、核心配置校验、网络快照和smoke test |
| Docs | `docs/` | 架构决策、安全边界、升级/验收说明和各版本历史发布说明 |

关键数据流和规则转换见仓库 `HANDOVER.md`、`docs/SSTAP-RULE-CONVERSION.md`、`docs/DECISIONS.md` 和 `docs/WINDOWS-ACCEPTANCE.md`。

## 4. 运行/构建环境

- 目标系统：Windows 10/11 x64。
- Node.js：22+；用户当前记录的 Windows 环境为 Node.js 26.13.0。
- npm：使用 `npm.cmd`（PowerShell 5.1 避免误调用 `npm.ps1`）。
- .NET SDK：10.x。
- PowerShell：5.1 或 PowerShell 7；所有项目脚本必须 UTF-8 with BOM。
- 核心：sing-box Windows AMD64；当前默认下载基线 1.14.4，需校验 SHA-256。
- 系统 TUN：需要 UAC，首次接管可能影响系统 IPv4/IPv6 路由和 DNS；先本地代理、再无路由 smoke、最后真实 TUN。

标准完整构建入口（Windows 项目根目录）：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

标准 Node 检查：

```powershell
npm.cmd run verify:lock
npm.cmd test
npm.cmd run doctor
npm.cmd run validate:core
```

## 5. 网络/安全不变量（禁止随意重构）

1. 本地 mixed 代理必须只绑定 loopback，不暴露 LAN，不自动写系统代理。
2. Renderer 不直接取得 Node/Electron 权限；主进程 IPC 必须验证可信 renderer 来源。
3. TUN 只能由独立 .NET Agent 经 UAC 启动；Agent 必须校验 session ID、配置 SHA-256、固定核心路径、重解析点、TUN 入站/出站/DNS/cache/log白名单。
4. sing-box 停止必须按当前实现使用进程组定向 CTRL+BREAK，并确认进程退出；之后确认本次会话的网卡资源回收。
5. `cleanup_error` 是安全锁，不得为“能再次连接”而无条件清除；不删除、不禁用不归本次会话的网卡。
6. 不使用猜测性 `route delete`、`netsh winsock reset`、清空 DNS 或关闭防火墙处理问题。
7. 默认 DNS IPv4-only 是当前用户节点/网络的适配设置，不是永久禁止 IPv6；双栈需网络和节点出口均可用 IPv6。
8. `package.json`/`package-lock.json` 要通过 `scripts/verify-package-lock.mjs`；不要无故升级依赖或重建 lockfile。
9. PowerShell 5.1 脚本 UTF-8 BOM；Windows npm 命令必须 `npm.cmd`。
10. 日志不得输出节点 URI、密码、订阅 URL、`state.enc.json`。

## 6. 标准目录布局

```text
SSTapNext/
  START HERE NEXT GPT.md          # 新对话唯一第一入口
  README.md
  HANDOVER.md
  PROJECT-OVERVIEW-CN.md
  PROJECT-DEVELOPMENT-LOG-CN.md  # 唯一持续追加的开发日志
  CHANGELOG.md
  docs/
    TEST-PLAN.md
    WINDOWS-ACCEPTANCE.md
    SSTAP-RULE-CONVERSION.md
    GITHUB-RELEASES.md
    RELEASE-X.Y.Z.md             # 每个正式版本一份发布说明
  apps/                           # Electron 主进程、Preload、React UI
  src/                            # shared Node 模块、.NET Agent
  scripts/                        # 构建、校验、smoke test
  runtime/                        # sing-box 核心
```

GitHub main 是当前源码事实来源。文件库中的旧版本 ZIP 和历史归档只作为历史记录，不得覆盖或拼接当前 Git 分支。0.1.0/0.2.0 原始 ZIP 仍是未核验历史存档，不用作当前基线。

## 7. 新对话接手顺序

1. **先读根目录 `START HERE NEXT GPT.md`**，它是当前状态、实际 Release、未完成事项和操作规则的唯一第一入口。
2. 读 `HANDOVER.md`，再读本文件 `PROJECT-OVERVIEW-CN.md`。
3. 读唯一主日志 `PROJECT-DEVELOPMENT-LOG-CN.md`；历史条目按时间理解，最新状态覆盖旧的临时指令。
4. 先实时读取 main 最新 commit、版本号、tag/release、最近 Actions 和各 job 结果；不要依赖旧 PR 分支。
5. 按本轮任务读取 `docs/TEST-PLAN.md`、`docs/WINDOWS-ACCEPTANCE.md`、`docs/SSTAP-RULE-CONVERSION.md` 等专题文档，再读相关代码和测试。
6. **先更新文档再开发**：写清目标、现状、方案、涉及文件、安全约束、验收标准、测试与回滚；之后才修改代码。开发中设计/范围变化要即时同步文档。
7. 直接在 main 做小而可验证的提交；正式功能迭代先递增版本号并同步 package.json/package-lock/UI/Agent/doctor 等版本来源，补充 CHANGELOG 和 docs/RELEASE-X.Y.Z.md。
8. main push 后确认对应 SHA 的 Node CI、Windows build 和 Release 都成功；出问题通过 GitHub Revert 回滚，不重写历史、不建立长期分支。随后仍需真实 Windows TUN/Wintun 验收。
9. 上下文即将结束时，先更新 START HERE NEXT GPT.md、HANDOVER.md 和 PROJECT-DEVELOPMENT-LOG-CN.md，写明准确完成进度、测试证据和下一步唯一动作。

## 8. 证据等级

- 归档验证、Node 单测、锁文件、语法、BOM、CSS静态计数均按本次 `BUILD-REPORT` 记载。
- Windows build、Agent编译、sing-box真实核心check、TS/Vite、NSIS、安装启动、Wintun、节点握手、公网出口和GUI验收必须分别有用户 Windows 输出或真实环境证据。
- GitHub Actions 的 Node 回归与 Windows 安装包构建可以证明自动化、Agent 编译、核心配置校验、TS/Vite、NSIS 等构建阶段通过；它们不能证明真实节点握手、系统路由/DNS、UDP/QUIC 或多轮 TUN 清理已经在用户机器上验收。以 main 对应 commit 的 Actions 运行结果及 GitHub Releases 实际资产为准。


## 9. 0.3.7 清理可靠性增量

Windows 可以在 sing-box 关闭后保留 Wintun 网络适配器对象。0.3.7 不再把“同名接口对象仍存在”单独视作活动残留；只有接口处于 `Up`，或仍持有本应用配置的 `172.19.0.1` TUN 地址，才视为活动资源并阻止再次接管。`Down` 且无 TUN 地址的适配器对象不被删除，视为本次 TUN 已释放。

GitHub Windows 流水线位于 `.github/workflows/windows-build.yml`：PR 触发完整 Windows 构建并上传 workflow artifact，但不发布正式 Release；main/tag 发布按版本检查后创建 Release 并上传 EXE、blockmap、SHA-256。目标公共仓库 `xiaobei206/SSTapNext` 已存在。


## 0.3.14 维护修复（2026-11-07）

0.3.13 批量节点检测已正式发布。用户实测发现 Windows 中文 ping.exe 子进程输出编码与 Node UTF-8 解码不一致时，严格依赖“时间/time”前缀的 RTT 正则会把有效 ICMP 回包误判为超时。0.3.14 将只按 ASCII 数值分隔符和 ms 提取 RTT，并增加乱码前缀回归测试；不改变节点测速、安全边界或系统代理行为。
