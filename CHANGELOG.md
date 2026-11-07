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
