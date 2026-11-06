# 架构决策记录

## ADR-001：不复用 Netch 代码

从头编写客户端和控制层。可以阅读其他项目的技术实现和兼容性经验，但不把旧 Netch 作为基础工程。

## ADR-002：sing-box 作为网络内核

首期采用固定正式稳定版，不自动升级。协议解析和 UI 与核心进程隔离，核心升级单独验收。

## ADR-003：sing-box 管理 Windows Wintun 生命周期

项目不重复实现 Wintun P/Invoke 和数据面环形缓冲区。系统 TUN 由 .NET Agent 在 UAC 提权后启动 sing-box，Agent 负责会话校验、心跳看门狗和停止后确认网卡移除。

## ADR-004：先无默认路由，再测试系统接管

独立 smoke test 显式 `auto_route=false`、`dns_mode=disabled`，只验证网卡创建/删除。真实系统 TUN 使用 `auto_route=true`、`strict_route=true`、`dns_mode=hijack`，必须通过 Windows 实机验收和前后路由/DNS 快照后才放行。

## ADR-005：本地节点凭据加密

Electron `safeStorage` 可用才读写节点状态；不允许悄悄降级成明文 JSON。

## ADR-006：订阅失败保留旧数据

先下载、限长、解析成功后，再更换订阅拥有的节点引用。刷新失败只更新错误信息，不覆盖旧节点列表。

## ADR-007：协议解析不静默丢字段

暂不支持的传输、插件或扩展参数必须报错，不得把 KCP 自动当 TCP，也不得忽略 Shadowsocks plugin 参数后仍显示“导入成功”。
