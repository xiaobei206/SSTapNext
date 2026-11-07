# SSTap Next 0.3.16 — TUN Clash API 白名单修复

状态：**已正式发布（2026-11-07）**。Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.16

## 用户复现与根因

用户在连接中心点击“启动系统接管”后收到：

`InvalidDataException: TUN 配置包含不允许的 endpoint 或外部控制接口。`

根因：0.3.15 的 TUN 配置开始启用 `experimental.clash_api` 采集实时流量，但管理员 Agent 的 `ValidateRestrictedTunConfig()` 一律拒绝 Clash API。

## 修复边界

- 根级 `endpoints` 仍然无条件禁止。
- 只允许 `experimental.clash_api` 的两个字段：`external_controller` 与 `secret`。
- 控制端点严格限定 `127.0.0.1:<1..65535>`；密钥必须为 64 位十六进制随机值。
- 重复字段、额外字段、LAN / 0.0.0.0 / IPv6 / 非 loopback 地址、无效端口和短密钥均拒绝。
- 保留 TUN 接口、出站、路由、DNS、缓存路径、会话文件 hash、网卡清理与 fail-closed 原有校验。

## 本次功能

- 连接中心实时下载/上传速度；本次下载累计与本次上传累计分开展示；会话时长。
- 节点管理显示每节点累计上传、累计下载与合计；PING、TCPING、代理延迟、下载速度及流量列支持升降序排序，缺失值置底。
- 节点个人累计只记录可准确归属的本地代理流量；TUN 总量包含 Direct 流量，只显示在连接中心。
- 左下角版本号淡化，普通 HTML small 字号统一为 14px。
- 流量 API 只监听随机 loopback 端口，使用每会话随机 Bearer secret，不通过 IPC 暴露。

## 自动化与构建验证

- Node CI run [42365153162](https://github.com/xiaobei206/SSTapNext/actions/runs/42365153162)：**107/107 tests PASS**。
- `npm run verify:lock`：**704/704 依赖引用 PASS**。
- Windows Release run [42365153123](https://github.com/xiaobei206/SSTapNext/actions/runs/42365153123)，job `128381544820`：**success，真实执行 Build-Windows、installer verification、Release publish 和 artifact upload**。
- 固定 sing-box 1.14.4：**58/58 配置检查 PASS**，含 Proxy / TUN Clash API 配置。
- .NET 10 Agent、TypeScript/Vite、Electron/NSIS、安装包、blockmap 与 SHA-256 验证全部成功。

## Release 资产

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| [SSTap.Next-0.3.16-x64.exe](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.16/SSTap.Next-0.3.16-x64.exe) | 174,898,679 bytes | `68c7094f74ef50c85ca96e9e07110be9397703fbaa915233a4634e5d8292261d` |
| [SSTap.Next-0.3.16-x64.exe.blockmap](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.16/SSTap.Next-0.3.16-x64.exe.blockmap) | 182,455 bytes | `93322a3e2a23b9c9e37f2bcc3a73cfb25050399d81149d2b702c02b6bebf8b36` |
| [SSTap.Next-0.3.16-x64.exe.sha256](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.16/SSTap.Next-0.3.16-x64.exe.sha256) | 93 bytes | `2c93e466bc6c92851ff55766de328c272c303aaf009e0f56bb92de18ff6caf40` |

- Release target commit: `6245eab7e953ff13c0f765691a8ad1692e15f14e`。
- Workflow artifact: `SSTapNext-main-Windows-x64`，ID `13571501499`，175,090,820 bytes。

## 收尾核验状态（2026-11-07）

- Release API 已核实本节列出的 EXE、blockmap、SHA-256 sidecar 三项资产实际存在；Release target commit 与构建 run 见上文。
- 正式 Release CI：107/107 Node 测试、704/704 lock 引用、sing-box 58/58、Agent、TS/Vite、NSIS、安装包校验及发布上传均成功。
- main 后续文档-only 提交不改变 v0.3.16 运行时代码或已发布安装包；对应 Windows workflow 因同版本 Release 已存在而跳过新的打包步骤，不作为第二次完整 build 的证据。

## Windows 10/11 实机验收（仍 NOT RUN）

- [ ] 安装 0.3.16 后启动系统 TUN，不再报外部控制接口拒绝错误。
- [ ] Global / bypass-cn / rule 下 TUN 流量实时变化；本次上传和下载累计分别增加。
- [ ] TUN 直连流量不计入节点个人累计；断开/重连及原有网卡、路由、DNS 清理行为正常。
- [ ] 本地代理速率、会话累计、节点历史累计持久化正常。
- [ ] 各页面字号与节点表格布局正常。

CI 与安装包验证不等于真实 Windows TUN 行为已通过实机验收。
