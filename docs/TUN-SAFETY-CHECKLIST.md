# TUN / Wintun 安全验收门槛（0.3.7）

## Gate 0 — 构建与只读审查

- [ ] Build-Windows.ps1 全部成功；sing-box 核心 SHA-256 与固定值一致。
- [ ] Agent .NET 10 win-x64 self-contained 发布成功。
- [ ] 安装包包含 sing-box、Agent、Start-Tun-Agent.ps1 与 Electron 文件。
- [ ] npm 自动化测试全部通过。
- [ ] 无真实节点凭据进入日志或 Harness。

## Gate 1 — 无路由 TUN smoke test

- [ ] 测试前导出完整路由、网卡、DNS 快照。
- [ ] `Run-Tun-SmokeTest.ps1` UAC 启动成功。
- [ ] 适配器名、IPv4 地址、Up 状态正确。
- [ ] 测试期间 IPv4/IPv6 默认路由不变。
- [ ] 测试期间除测试适配器外其他 ActiveStore 路由不变。
- [ ] 现有物理网卡 DNS 不变。
- [ ] 停止后测试适配器消失，所有快照恢复一致。
- [ ] 连续两次通过。

Gate 1 任一项失败，不进入 Gate 2。

## Gate 2 — 本地代理真实节点

- [ ] 真实节点核心预检通过，sing-box 稳定运行。
- [ ] SOCKS5 / HTTP 仅监听 loopback。
- [ ] 实际 HTTP 请求和下载测速经所选节点完成。
- [ ] 断开后核心和临时配置清理，普通系统网络不受影响。

## Gate 3 — TUN 全球代理

- [ ] 使用 Gate 2 已验证的节点；有备用网络和恢复手段。
- [ ] UAC 授权后 Agent 和 sing-box 状态进入 running。
- [ ] IPv4 TCP 流量经节点；IPv6 行为符合明确策略，无意外直连。
- [ ] UDP/QUIC 流量实际可用，或明确记录限制。
- [ ] 普通 DNS 经预期 DoH 路径，节点 endpoint bootstrap 无递归。
- [ ] 正常断开后 TUN 网卡移除，路由/DNS/接口指标恢复基线。

Gate 3 任一项失败，不进入 Gate 4。

## Gate 4 — 分流策略

- [ ] bypass-cn：geosite-cn / geoip-cn 对应流量直连，其余走代理；大陆 DNS direct，境外 DNS via selected-proxy。
- [ ] custom rules：DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、IP-CIDR6、PROCESS-NAME、PROCESS-PATH、DST-PORT、NETWORK 命中符合规则顺序。
- [ ] direct / proxy / block 行为分别实测，不仅以 UI 状态作为证据。
- [ ] rule-set 更新失败时有清晰日志，不能静默误报已加载。

## Gate 5 — 故障恢复

- [ ] UAC 取消时不残留 Agent/核心/虚拟网卡。
- [ ] 核心启动失败时不残留接口/路由/DNS。
- [ ] 正常关闭应用可清理。
- [ ] 强制结束 Electron 后心跳超时能清理。
- [ ] 核心异常退出能报告状态并确认接口移除。
- [ ] 网络切换、DHCP 续租、休眠唤醒后行为明确且可恢复。
- [ ] `cleanup_error` 会锁定再次连接，且没有自动猜测性路由清理。

**任一阶段的路由、DNS 或网卡清理未通过，应停止后续阶段。不得自动 route delete、netsh winsock reset、清空 DNS 或关闭防火墙来追求“恢复”。**


## 0.3.7 — Wintun 持久化设备对象判定

- [ ] sing-box PID 确认退出后，检查 `SSTap Next` 对应 `sing-tun Tunnel` 接口。
- [ ] `Status=Down` 且没有 `172.19.0.1` 时，视为当前会话的 TUN 已释放；Windows 保留设备对象本身不构成清理失败，程序不得删除该对象。
- [ ] `Status=Up` 或仍持有 `172.19.0.1` 时，仍视为活动/残留资源，保持 `cleanup_error` 锁定。
- [ ] 至少执行 10 轮连接/断开/重连，确保不会随着运行时间增加而反复累积 `cleanup_error`。
