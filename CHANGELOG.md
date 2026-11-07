## 0.3.14 — Windows ICMP PING 解析修复（2026-11-07 已发布）

- 修复 Windows 中文 ping.exe 子进程输出经过 UTF-8 解码后，中文前缀乱码导致有效 RTT 未被识别、批量 PING 误报全部超时的问题。
- RTT 提取不再依赖英文/中文前缀，正确识别 `=43ms` 与 `<1ms`；保留丢包、DNS 失败和真正超时状态。
- 增加 OEM 代码页乱码场景回归测试；不改变 TCPING、代理延迟、下载测速、系统代理或 TUN 安全行为。

## 0.3.13 — 节点管理页批量检测与测速

- 节点列表新增一键全部检测、勾选节点检测、全选、取消与逐节点进度。
- 节点列表直接显示 ICMP PING、TCPING、真实代理 HTTP 延迟、下载 Mbps 和最近检测时间；Hysteria2 的 TCPING 显示不适用。
- 新增独立批量检测 runner；每批最多 32 节点只启动一个临时 sing-box 进程，每个节点通过独立 loopback mixed inbound 绑定自身 outbound，未匹配路由 final=block。
- 测速不调用主 CoreController，不切换/断开用户当前连接，不修改 Windows 系统代理；TUN 不安全状态时拒绝启动批测。
- 新增批量节点并发 1/2/4/8/16/32 和 Range 下载线程 1/2/4/8/16/32；总 Range worker 预算上限 64，支持任意节点数量并向下选取有效线程档位。
- 新增按 nodeId 加密保存检测结果，最多保留 512 个节点记录，并在保存状态时清理已删除节点的孤儿结果。
- Build-Windows 实际 sing-box 配置检查新增多节点批测配置，总计 56 组（54 基础 + SSTap 规则 + 批测配置）。

自动化构建状态与 Windows 实机验收边界见 docs/RELEASE-0.3.13.md 和 docs/WINDOWS-ACCEPTANCE.md。1/2/4/8/16/32 并发压力、系统代理不变、活动连接隔离和取消清理仍需在用户 Windows 设备实测。


## 0.3.12 — SSTap 经典规则库转换与应用内更新

- 新增 FQrabbit/SSTap-Rule 原生 `.rules` 解析器：保留第三字段动作（0=代理、1=直连），支持 IPv4/IPv6 CIDR、重复去除和整文件校验。
- 新增应用内上游更新器：按 Git commit 固定版本下载 ZIP，校验 ZIP CRC，转换为 sing-box 本地 source JSON 规则集；下载/转换失败时保留上一有效版本。
- 新增分流页面规则库管理、搜索、启停与“检查并更新规则库”按钮；规则数据存于用户数据目录，更新不需要重新编译/安装软件。
- 中国大陆模式自动叠加上游 BypassCNandLan 规则，并保留 MetaCubeX GeoSite / GeoIP 远程 GEO 作为域名与 IP 兜底；游戏规则优先于宽泛中国 GEO 路由。
- 规则选择随用户加密设置保存；规则更新后自动清理已从上游移除的选择。
- 修复主进程 User-Agent 版本号长期写死为 0.3.7 的问题，改为读取 package.json。


## 0.3.11 — 识别已失效的 TUN 网卡对象并解除旧清理锁

- 修复 0.3.10 对历史 GUID 不存在的判断过严：Windows 仍列出若干 `NotPresent` 的 sing-tun 诊断/测试适配器时，不再因此永久拦截恢复。
- PowerShell 与 .NET Agent 的完整枚举结果允许包含 `Down`、`Disconnected` 或 `NotPresent` 且无任何 IP 的遗留接口；只有全部相关接口均非活动、未持有 TUN 地址，且历史 sing-box PID 不在运行时才可归档旧状态。
- 任一相关接口处于 `Up`、仍有 IP 地址、地址/接口检查失败、状态未知或进程检查不完整时，继续 fail-closed 阻止启动。
- 保留原始 `cleanup_error` 状态和日志；不删除网络适配器、Wintun 驱动、路由或 DNS。


## 0.3.10 — TUN 遗留状态双重核验与真实缺失恢复

- 修复 0.3.9 对历史 Wintun GUID 的严格查找在接口已被 Windows 移除时仍永久保留旧清理锁的问题。
- PowerShell 与 .NET Agent 分别枚举网络接口；只有两边均完整确认历史 GUID 和所有 SSTap/sing-tun 相关接口均不存在，且历史 sing-box PID 不再运行，才按“接口已不存在”安全归档旧错误状态。
- 若发现同名/同驱动接口、活动 sing-box 进程、重复 GUID、地址仍在或任一枚举/进程检查失败，仍保持 fail-closed，禁止启动 TUN。
- 补充 UTF-8 PowerShell 输出、matchCount、相关接口候选和 PID 检查诊断，避免错误信息乱码及“找不到”原因被吞掉。
- 不删除网卡、Wintun 驱动、路由、DNS 或原始日志；旧 status.json 归档为 status.cleanup_error-legacy.json。

验证边界：Node 回归测试与 GitHub Actions Windows 编译/打包用于验证代码；真实 Windows 网卡结果仍以用户机器运行时的只读枚举为准。

## 0.3.7 — Wintun 持久化 Down 接口清理误报修复

- 修复 sing-box 正常退出后，Windows 仍保留 `sing-tun Tunnel` 网卡对象（`Status=Down`、没有 `172.19.0.1` 地址）却被误判为本次会话清理残留的问题。
- 清理判据现在要求接口仍处于 `Up`，或仍持有 SSTap Next 的 TUN 地址；Down 且无 TUN 地址的持久化对象视为已释放，不删除网卡。
- 保留活动资源保护：Up 接口或仍持有 TUN 地址时，继续写入 `cleanup_error` 并阻止再次接管。
- 增加回归契约测试，覆盖“Down + 无地址”可正常断开，以及“Up/仍有地址”继续受保护。
- 增加 GitHub Actions：发布 `v*` tag 后，在 Windows runner 构建完整安装包，并将 EXE、blockmap、SHA-256 自动上传到该 Release。

验证边界：本地 Node 自动化与源码契约测试可运行；Windows .NET Agent 编译、真实 sing-box 配置矩阵、NSIS 打包和长时间反复断开/重连仍须在 Windows/GitHub Actions 上验证。

# Changelog

## 0.3.6 — IPv6 选项、测速容错与 UI 可读性

- 保留 IPv4-only 安全默认，新增 IPv4 优先和 IPv6 优先双栈 DNS 选项。
- 测速迁移至 Hetzner/OVHcloud/Tele2 公开测试文件，增加跨服务商自动回退，处理 HTTP 403 等源站错误。
- 主系统接管按钮增加可用/悬停/按下/焦点状态，并显示禁用原因。
- 设置页增加实际 sing-box 版本、打开内核目录及手动替换说明。
- 配置检查支持对当前放置的核心动态执行 54 份配置验证；默认下载仍锁定审查版本。
- 全局小字号至少提升至 14px。
- 不改动 0.3.5 已验证的 TUN IPv4-only 默认和清理安全逻辑。

## 0.3.5 — TUN IPv4-only DNS fallback

- 对选中节点的域名解析使用 IPv4-only DNS，同时保留双栈 TUN 地址和路由接管。
- 使用独立 DNS 缓存文件名，避免旧 AAAA 缓存影响。
