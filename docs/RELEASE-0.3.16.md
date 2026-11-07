# SSTap Next 0.3.16 — TUN Clash API 白名单修复

状态：**开发与验证中，尚未发布。** 最新公开 Release：v0.3.15。目标版本：v0.3.16。

## 用户复现与根因

用户在连接中心点击“启动系统接管”后收到：

`InvalidDataException: TUN 配置包含不允许的 endpoint 或外部控制接口。`

根因已确认：0.3.15 新增了 TUN 会话实时流量统计，TUN 配置显式包含 `experimental.clash_api`。管理员 Agent 的 `ValidateRestrictedTunConfig()` 仍将 Clash API 一律拒绝，因而在配置策略验证阶段阻止启动。该问题不是节点连通性问题。

## 修复边界

- 继续无条件拒绝根级 `endpoints`。
- 只允许 `experimental.clash_api` 的两个字段：`external_controller` 与 `secret`。
- 控制端点严格限定 `127.0.0.1:<1..65535>`；密钥必须为 64 位十六进制随机值。
- 重复字段、额外字段、LAN / 0.0.0.0 / IPv6 / 任意非 loopback 地址、无效端口、短密钥均拒绝。
- 保留 TUN 接口、出站、路由、DNS、缓存路径、会话文件 hash、网卡清理与 fail-closed 的原有校验，不因流量统计而关闭 Agent 安全检查。

## 本次包含功能

- 连接中心实时下载/上传速度；本次下载累计与本次上传累计分开展示；会话时长。
- 节点管理分别显示累计上传、累计下载和总流量；节点表头支持升降序，缺失值始终置底。
- 节点个人累计只记录可归属的本地代理流量；TUN 本次总量明确包含 Direct 流量，不记入节点个人累计。
- 左下角版本号淡化；普通小字统一至少 14px。
- 流量 API 仅监听随机 loopback 端口、使用每会话随机 Bearer secret；不向 Renderer 暴露密钥。

## 自动化验收

- [ ] `npm test` 全量通过。
- [ ] `npm run verify:lock` 全量通过。
- [ ] 固定 sing-box 1.14.4 的真实配置矩阵 58/58（54 基础组合 + SSTap rule-set + batch + Proxy traffic API + TUN traffic API）。
- [ ] .NET 10 Agent 编译成功。
- [ ] TypeScript/Vite、NSIS 安装包、EXE、blockmap、SHA-256 sidecar 全链路完成。
- [ ] GitHub Actions 对本次目标 SHA 成功，Release API 确认三项资产存在，并核对 SHA-256。

## Windows 10/11 实机验收（NOT RUN）

- [ ] 安装 0.3.16 后，系统 TUN 可以启动，不再报外部控制接口拒绝错误。
- [ ] Global / bypass-cn / rule 下 TUN 流量实时变化；本次上传累计与下载累计分别增加。
- [ ] TUN direct 流量不计入节点个人累计；断开/重连与原有网卡/路由/DNS 清理行为正常。
- [ ] 本地代理上/下载速率、会话累计、节点历史累计持久化正常。
- [ ] 版本号与各页字号布局正常。

CI 通过不等于真实 Windows TUN 行为已通过实机验收。
