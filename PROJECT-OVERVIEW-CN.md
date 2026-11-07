# SSTap Next 项目总体说明

## 1. 项目标识与当前状态

- 项目根目录（文件库）：`/sstap/SSTapNext/`
- main 分支当前版本：**0.3.11**。
- 当前功能开发版本：**0.3.12**，位于 `feature/sstap-rule-library-0312`，通过 PR #1 提交，尚未合并。
- 近期用户确认真实功能可用的历史版本：**0.3.5**（用户反馈系统级代理/YouTube 已恢复正常；不可将此反馈外推为 0.3.12 的实机验收）。
- 0.3.12 增加原版 FQrabbit SSTap `.rules` 转换、规则库在线更新、分流页面规则管理、游戏规则叠加和优先级保护。Node CI、Windows 构建均通过的结论必须以 PR 最新 HEAD 的 Actions 状态为准；TUN/Wintun 实机循环仍需用户 Windows 设备验收。
- 当前唯一可信开发入口：GitHub 仓库 `xiaobei206/SSTapNext`；功能开发分支 `feature/sstap-rule-library-0312`。新对话先读根目录 `HANDOVER.md`，不要再从旧 0.3.7 ZIP 或文件库历史包拼接源码。

## 2. 用途与功能

SSTap Next 是 Windows 代理客户端，提供节点/订阅导入、sing-box 本地 SOCKS/HTTP mixed 代理、节点测速、Windows 系统级 TUN、全局/绕过中国大陆/自定义规则分流、DNS 地址族策略和手动 sing-box 核心升级。

### 已实现功能基线（main 0.3.11 + PR #1 中的 0.3.12 增量；PR 未合并前不得把 0.3.12 当作正式 main 发布）

- 节点协议：VLESS、Hysteria2、Shadowsocks SIP002、VMess、Trojan，以及已实现的 TLS/Reality/WebSocket/gRPC/混淆参数边界。
- 订阅：单节点、多节点、Base64 列表、刷新、稳定 ID、来源管理、失败原子保留旧列表。
- 凭据：Electron `safeStorage` 可用才保存/解密；不得降级写明文。
- 本地代理：sing-box mixed inbound，仅监听 `127.0.0.1`，不自动改 Windows 系统代理。
- 测速：通过选中节点 SOCKS5，Range/多线程/取消/历史记录，并有多个公开测速源回退。
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
  PROJECT-OVERVIEW-CN.md
  PROJECT-DEVELOPMENT-LOG-CN.md
  0.3.0/ ... 0.3.12/            # 每版本独立源码 ZIP、HANDOFF、BUILD-REPORT、MANIFEST、SHA256、Windows验收命令
```

GitHub 仓库 `xiaobei206/SSTapNext` 是当前源码的事实来源。版本归档与文件库历史副本只作为历史记录，不得覆盖或拼接当前 Git 分支。0.1.0/0.2.0 原始 ZIP 仍是未核验历史存档，不用作当前基线。

## 7. 新对话接手顺序

1. 读 `PROJECT-OVERVIEW-CN.md`。
2. 读唯一主日志 `PROJECT-DEVELOPMENT-LOG-CN.md`。
3. 读 `HANDOVER.md`（0.3.12 当前交接）。
4. 读取 PR #1 最新 HEAD、评论、CI 与 Windows Build Actions；不要假设 HEAD 和上一轮相同。
5. 检查 `.rules` 解析器、ZIP 更新器、TUN route 顺序、Electron IPC、Renderer UI 和测试。
6. 先在 PR 分支追加小而可验证的提交；不要把 0.3.12 代码直接写进 main。
7. 合并前要求 PR 最新 HEAD 的 Node CI 与 Windows build 全绿；随后仍需真实 Windows TUN/Wintun 验收。

## 8. 证据等级

- 归档验证、Node 单测、锁文件、语法、BOM、CSS静态计数均按本次 `BUILD-REPORT` 记载。
- Windows build、Agent编译、sing-box真实核心check、TS/Vite、NSIS、安装启动、Wintun、节点握手、公网出口和GUI验收必须分别有用户 Windows 输出或真实环境证据。
- GitHub Actions 的 Node 回归与 Windows 安装包构建可以证明自动化、Agent 编译、核心配置校验、TS/Vite、NSIS 等构建阶段通过；它们不能证明真实节点握手、系统路由/DNS、UDP/QUIC 或多轮 TUN 清理已经在用户机器上验收。具体 PR HEAD 与 Actions 运行结果以 PR #1 为准。


## 9. 0.3.7 清理可靠性增量

Windows 可以在 sing-box 关闭后保留 Wintun 网络适配器对象。0.3.7 不再把“同名接口对象仍存在”单独视作活动残留；只有接口处于 `Up`，或仍持有本应用配置的 `172.19.0.1` TUN 地址，才视为活动资源并阻止再次接管。`Down` 且无 TUN 地址的适配器对象不被删除，视为本次 TUN 已释放。

GitHub Windows 流水线位于 `.github/workflows/windows-build.yml`：PR 触发完整 Windows 构建并上传 workflow artifact，但不发布正式 Release；main/tag 发布按版本检查后创建 Release 并上传 EXE、blockmap、SHA-256。目标公共仓库 `xiaobei206/SSTapNext` 已存在。
