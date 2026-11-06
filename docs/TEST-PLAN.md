# 0.3.7 测试计划与当前证据

## 本轮设计覆盖

| 项目 | 测试范围 | 说明 |
|---|---|---|
| Node 自动化回归 | 67 项，串行 | 节点解析、代理生命周期、TUN 状态机、DNS 策略、缓存路径、测速、UI/构建契约 |
| package-lock | 704 个依赖引用 | 版本、根依赖及 semver 锁定匹配 |
| DNS 生成 | IPv4-only / 双栈 IPv4 优先 / 双栈 IPv6 优先 | 三种模式均保留双栈 TUN 地址 |
| DNS 缓存隔离 | 3 个独立缓存文件名 | Agent 只允许固定文件名并限制在用户 cache 目录 |
| 测速 403 回退 | 本地模拟 HTTP 403 + 可用备用 HTTP 源 | 验证自动切换、实际 URL 和进度提示 |
| UI 契约 | 字号下限、主按钮交互、禁用原因、DNS/核心入口 | 防止后续样式和 IPC 改动回归 |
| 核心升级脚本 | 当前核心版本动态检测 | 默认下载仍锁定审查版本；手动替换后使用当前二进制检查配置 |

## 0.3.7 新增回归场景

- `Down` 且不含 `172.19.0.1` 的持久化 Wintun 适配器对象不再被判定为活动清理残留；不删除该对象。
- `Up` 或仍含 `172.19.0.1` 的接口必须继续阻止下一次接管。
- 0.3.7 Node suite 的两条 source-contract 测试覆盖上述判据；它们不是 .NET 编译或 Wintun 实机测试。

## 必须在 Windows 上由 Build-Windows.ps1 执行

| 项目 | 当前状态 | 命令 |
|---|---|---|
| sing-box 当前核心 54 份配置检查 | 未在本 Linux 容器执行 | `npm.cmd run validate:core` |
| .NET 10 win-x64 Agent 编译/发布 | 未在本 Linux 容器执行 | `scripts\Publish-Agent.ps1` |
| TypeScript / Vite 正式构建 | 未在本 Linux 容器执行 | `npm.cmd run build` |
| NSIS 安装包 | 未在本 Linux 容器执行 | `npm.cmd run dist:win` |
| 完整 Windows 流水线 | 未在本 Linux 容器执行 | `scripts\Build-Windows.ps1` |

## 必须由用户确认的真实机器测试

- npm registry 的实际安装与 Electron postinstall 下载。
- Windows Wintun 创建/清理、UAC 和路由/DNS 恢复。
- 本地代理真实节点连接及下载测速源回退。
- IPv4-only 下实际浏览器访问；双栈 DNS 两种优先级须在真实 IPv6 接入网络和具备 IPv6 出口的节点上分别测试。
- TUN 全局 / bypass-cn / custom-rule 以及 UDP/QUIC。
- 手动 sing-box 替换与失败回滚。

**当前开发容器不是 Windows，没有 .NET 10 SDK、Wintun 驱动或 Windows sing-box 核心。Node 测试通过不代表 Windows Agent 编译、54 份真实 `sing-box check`、NSIS 或 TUN 实机验收通过。**
